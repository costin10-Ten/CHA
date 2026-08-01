-- =============================================================================
-- Phase 7：逐句驗證結果
-- =============================================================================

-- 1. answer_sessions 增加驗證統計 ---------------------------------------------
alter table public.answer_sessions
  add column if not exists verified_at timestamptz,
  add column if not exists supported_count integer not null default 0,
  add column if not exists partial_count integer not null default 0,
  add column if not exists unsupported_count integer not null default 0,
  add column if not exists publishable boolean not null default false,
  add column if not exists published_answer text;

comment on column public.answer_sessions.publishable is
  '沒有任何紅色（unsupported）句子時才為 true。';
comment on column public.answer_sessions.published_answer is
  '移除紅色句子後的發布稿。紅色句子不得進入這裡。';

-- 2. answer_sentences 增加判定細節 ---------------------------------------------
alter table public.answer_sentences
  add column if not exists similarity real not null default 0,
  add column if not exists supporting_refs text[] not null default '{}';

comment on column public.answer_sentences.supporting_refs is
  '支持這句話的知識編號（K-0001…），供介面顯示。';

create index if not exists answer_sentences_verdict_idx
  on public.answer_sentences (owner_id, verdict);

-- 3. 寫入驗證結果 -------------------------------------------------------------
-- 一次交易內更新整個 session 的判定與統計，避免出現「一半驗證過」的狀態。
create or replace function public.apply_answer_verification(
  p_session_id uuid,
  p_sentences jsonb,
  p_published_answer text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_supported integer := 0;
  v_partial integer := 0;
  v_unsupported integer := 0;
  v_item jsonb;
begin
  select owner_id into v_owner
  from public.answer_sessions
  where id = p_session_id and owner_id = (select auth.uid());

  if v_owner is null then
    raise exception '找不到問答紀錄或無權限';
  end if;

  for v_item in select * from jsonb_array_elements(p_sentences)
  loop
    update public.answer_sentences
    set
      verdict = (v_item ->> 'verdict')::public.sentence_verdict,
      note = nullif(v_item ->> 'note', ''),
      similarity = coalesce((v_item ->> 'similarity')::real, 0),
      supporting_refs = coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(v_item -> 'supporting_refs')),
        '{}'
      ),
      supporting_fact_ids = coalesce(
        (select array_agg(value::uuid) from jsonb_array_elements_text(v_item -> 'supporting_fact_ids')),
        '{}'
      )
    where answer_session_id = p_session_id
      and position = (v_item ->> 'position')::integer;

    case v_item ->> 'verdict'
      when 'supported' then v_supported := v_supported + 1;
      when 'partial' then v_partial := v_partial + 1;
      else v_unsupported := v_unsupported + 1;
    end case;
  end loop;

  update public.answer_sessions
  set
    verified_at = timezone('utc', now()),
    supported_count = v_supported,
    partial_count = v_partial,
    unsupported_count = v_unsupported,
    publishable = (v_unsupported = 0 and (v_supported + v_partial) > 0),
    published_answer = case
      when v_unsupported = 0 and (v_supported + v_partial) > 0 then p_published_answer
      else null
    end,
    status = case
      when v_unsupported > 0 then 'blocked'::public.answer_status
      else 'verified'::public.answer_status
    end
  where id = p_session_id;
end;
$$;

comment on function public.apply_answer_verification is
  '寫入逐句判定並更新統計；只要有一句 unsupported，整份回答就標為 blocked 且不產生發布稿。';

grant execute on function public.apply_answer_verification(uuid, jsonb, text) to authenticated;
