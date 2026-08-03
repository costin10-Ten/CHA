-- =============================================================================
-- 修正 pkb_insert_items：column reference "status" is ambiguous
--
-- 上一版寫成 `returns table (id uuid, status public.pkb_status)`。
-- plpgsql 會把回傳欄位名當成函式內的變數，於是
--
--     on conflict (owner_id, statement_hash) where status <> 'trashed'
--
-- 裡的 status 同時可以指向「回傳欄位 status」與「pkb_items.status」，
-- Postgres 無法決定，整個匯入失敗。
--
-- 修法不是去加限定詞或 #variable_conflict，而是**讓衝突不可能發生**：
-- 這個函式一律以 draft 寫入，回傳 status 本來就是多餘的，
-- 改成 `returns setof uuid` 就沒有任何具名回傳欄位可以撞名。
--
-- 回傳型別改變不能用 create or replace，必須先 drop。
-- =============================================================================

drop function if exists public.pkb_insert_items(jsonb);

create function public.pkb_insert_items(p_items jsonb)
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
begin
  if v_owner is null then
    raise exception '尚未登入';
  end if;

  return query
  insert into public.pkb_items (
    owner_id,
    import_batch_id,
    statement,
    source_type,
    source_label,
    source_url,
    source_note,
    is_self_authored,
    subject,
    predicate,
    object,
    tags,
    statement_hash
  )
  select
    v_owner,
    nullif(item ->> 'import_batch_id', '')::uuid,
    item ->> 'statement',
    (item ->> 'source_type')::public.pkb_source_type,
    item ->> 'source_label',
    nullif(item ->> 'source_url', ''),
    nullif(item ->> 'source_note', ''),
    coalesce((item ->> 'is_self_authored')::boolean, false),
    nullif(item ->> 'subject', ''),
    nullif(item ->> 'predicate', ''),
    nullif(item ->> 'object', ''),
    coalesce(
      (select array_agg(value #>> '{}') from jsonb_array_elements(item -> 'tags')),
      '{}'::text[]
    ),
    item ->> 'statement_hash'
  from jsonb_array_elements(p_items) as item
  -- 部分索引要在這裡重述它的條件，Postgres 才推斷得出來用哪一個。
  on conflict (owner_id, statement_hash) where status <> 'trashed'
  do nothing
  returning public.pkb_items.id;
end;
$$;

grant execute on function public.pkb_insert_items(jsonb) to authenticated;

comment on function public.pkb_insert_items is
  '批次寫入原子知識（一律 draft），已經收過的同一句話直接略過。回傳實際寫入的 id。';
