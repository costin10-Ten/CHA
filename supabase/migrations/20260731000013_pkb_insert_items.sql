-- =============================================================================
-- 個人原子知識庫：批次寫入函式
--
-- 為什麼需要這個：pkb_items 的去重索引是**部分唯一索引**
--
--   create unique index pkb_items_statement_key
--     on public.pkb_items (owner_id, statement_hash)
--     where status <> 'trashed';
--
-- 「部分」是刻意的——垃圾桶裡的不算重複，才能「丟掉之後重新匯入」。
--
-- 但 PostgREST 的 upsert 只會送出 `on_conflict=owner_id,statement_hash`，
-- 沒辦法帶索引的 where 條件，Postgres 因此推斷不出要用哪個索引，
-- 回報 "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification"。
--
-- 在 SQL 裡就沒有這個限制：`on conflict (...) where <predicate>` 可以
-- 明確指定部分索引。順帶把「插入」與「判斷重複」放進同一個語句，
-- 不會有先查詢再寫入的競態。
--
-- 這個函式**一律以 draft 寫入**，不接受 status 參數。
-- 要直接生效的（匯入時勾「沿用檔案的同意結果」）由呼叫端接著呼叫
-- pkb_approve_item。理由是同意這件事不只改狀態，還要建實體與關聯、
-- 寫審核歷程；如果這裡能直接寫成 active，就會產生「已同意但沒有圖譜」
-- 的知識，而且 pkb_approve_item 看到它已經是 active 會直接跳過，
-- 永遠補不回來。同意只有一條路。
-- =============================================================================

create or replace function public.pkb_insert_items(p_items jsonb)
returns table (id uuid, status public.pkb_status)
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
  returning public.pkb_items.id, public.pkb_items.status;
end;
$$;

grant execute on function public.pkb_insert_items(jsonb) to authenticated;

comment on function public.pkb_insert_items is
  '批次寫入原子知識（一律 draft），已經收過的同一句話直接略過。回傳實際寫入的列。';
