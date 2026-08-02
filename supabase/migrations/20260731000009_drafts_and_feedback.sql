-- =============================================================================
-- Phase 8：風險溝通素材、抽取回饋與排程更新
-- =============================================================================

-- 1. 列舉型別 ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'draft_type') then
    create type public.draft_type as enum (
      'faq',
      'explainer',
      'article',
      'podcast_outline',
      'podcast_script',
      'video_60s',
      'video_3min',
      'card_text',
      'media_qa',
      'social_post'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'draft_status') then
    create type public.draft_status as enum ('draft', 'edited', 'final', 'blocked');
  end if;
  if not exists (select 1 from pg_type where typname = 'feedback_type') then
    create type public.feedback_type as enum (
      'beyond_source',
      'condition_lost',
      'number_error',
      'certainty_escalated',
      'wrong_subject',
      'bad_sentence_split',
      'quote_mismatch',
      'other'
    );
  end if;
end
$$;

-- 2. communication_drafts ---------------------------------------------------
create table if not exists public.communication_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  draft_type public.draft_type not null,
  title text not null,
  body text not null,
  edited_body text,
  audience text not null default '一般民眾',
  tone text not null default '平實',
  status public.draft_status not null default 'draft',

  -- 使用了哪些核定原子命題（工作單第 15 節要求保存）
  knowledge_fact_ids uuid[] not null default '{}',
  knowledge_refs text[] not null default '{}',

  provider text,
  model text,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  model_run_id uuid references public.model_runs (id) on delete set null,

  -- 逐句驗證結果
  verified_at timestamptz,
  supported_count integer not null default 0,
  partial_count integer not null default 0,
  unsupported_count integer not null default 0,
  publishable boolean not null default false,
  verification jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.communication_drafts is
  '風險溝通素材草稿。所有產出預設為草稿，且必須記錄使用的核定原子命題與驗證結果。';

create index if not exists communication_drafts_owner_idx
  on public.communication_drafts (owner_id, created_at desc);
create index if not exists communication_drafts_type_idx
  on public.communication_drafts (owner_id, draft_type, status);

-- 3. extraction_feedback ----------------------------------------------------
create table if not exists public.extraction_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  candidate_fact_id uuid references public.candidate_facts (id) on delete set null,
  source_id uuid references public.sources (id) on delete cascade,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  model_run_id uuid references public.model_runs (id) on delete set null,
  feedback_type public.feedback_type not null,
  description text,
  -- 回報當下的快照，候選原子命題日後被修改或刪除仍看得到問題內容
  statement_snapshot text,
  quote_snapshot text,
  paragraph_snapshot text,
  resolved boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.extraction_feedback is
  'AI 抽取問題回報。與 review_records 分開：那是審核歷程，這是模型品質回饋，用於改進提示詞。';

create index if not exists extraction_feedback_owner_idx
  on public.extraction_feedback (owner_id, created_at desc);
create index if not exists extraction_feedback_prompt_idx
  on public.extraction_feedback (prompt_version_id, feedback_type);

-- 4. updated_at 觸發器與 RLS --------------------------------------------------
alter table public.communication_drafts enable row level security;
alter table public.extraction_feedback enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['communication_drafts', 'extraction_feedback']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = owner_id)',
      t || '_select_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)',
      t || '_insert_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
      t || '_update_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)',
      t || '_delete_own', t
    );
  end loop;
end
$$;

-- 5. 提示詞品質統計 -----------------------------------------------------------
-- /settings/prompts 用來判斷某一版提示詞是不是常出問題。
create or replace function public.prompt_feedback_stats(p_owner uuid default null)
returns table (
  prompt_version_id uuid,
  prompt_name text,
  prompt_version integer,
  feedback_count bigint,
  unresolved_count bigint,
  top_issue public.feedback_type
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select f.*
    from public.extraction_feedback f
    where f.owner_id = coalesce(p_owner, (select auth.uid()))
  )
  select
    v.id,
    v.name,
    v.version,
    count(s.id) as feedback_count,
    count(s.id) filter (where not s.resolved) as unresolved_count,
    (
      select s2.feedback_type
      from scoped s2
      where s2.prompt_version_id = v.id
      group by s2.feedback_type
      order by count(*) desc
      limit 1
    ) as top_issue
  from public.prompt_versions v
  left join scoped s on s.prompt_version_id = v.id
  where v.owner_id = coalesce(p_owner, (select auth.uid()))
  group by v.id, v.name, v.version
  order by count(s.id) desc, v.name, v.version desc;
$$;

grant execute on function public.prompt_feedback_stats(uuid) to authenticated;

-- 6. 排程更新：找出需要重新抓取的網址來源 ---------------------------------------
create or replace function public.enqueue_scheduled_updates(
  p_max_age_hours integer default 168,
  p_owner uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_source record;
begin
  for v_source in
    select s.id, s.owner_id
    from public.sources s
    where s.source_type = 'url'
      and s.status in ('ready', 'failed')
      -- 指定 owner 時只處理該使用者的來源；cron 以 service_role 呼叫時處理全部。
      and (p_owner is null or s.owner_id = p_owner)
      and (
        s.fetched_at is null
        or s.fetched_at < timezone('utc', now()) - make_interval(hours => p_max_age_hours)
      )
      -- 已經排隊中的不重複排入
      and not exists (
        select 1 from public.processing_jobs j
        where j.source_id = s.id
          and j.job_type = 'parse_document'
          and j.status in ('pending', 'processing', 'retrying')
      )
  loop
    insert into public.processing_jobs (owner_id, job_type, source_id, payload)
    values (
      v_source.owner_id, 'parse_document', v_source.id,
      jsonb_build_object('scheduled', true)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.enqueue_scheduled_updates is
  '排程更新：把過期的網址來源重新排入解析。內容雜湊未變時解析器不會建立新版本。';

revoke all on function public.enqueue_scheduled_updates(integer, uuid) from public;
grant execute on function public.enqueue_scheduled_updates(integer, uuid) to service_role;
grant execute on function public.enqueue_scheduled_updates(integer, uuid) to authenticated;

-- 舊簽章若已存在（開發過程中的版本）就移除，避免呼叫時發生 ambiguous function。
drop function if exists public.enqueue_scheduled_updates(integer);
