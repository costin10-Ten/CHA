-- =============================================================================
-- Phase 4：審核紀錄與候選原子命題的審核欄位
-- =============================================================================

-- 1. 審核動作型別 ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'review_action') then
    create type public.review_action as enum (
      'approve',
      'approve_with_edit',
      'reject',
      'needs_fix',
      'split',
      'merge',
      'reextract',
      'reopen'
    );
  end if;
end
$$;

-- 2. candidate_facts 增加審核欄位 ---------------------------------------------
alter table public.candidate_facts
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists edited boolean not null default false,
  add column if not exists parent_fact_id uuid references public.candidate_facts (id) on delete set null,
  add column if not exists merged_into uuid references public.candidate_facts (id) on delete set null,
  add column if not exists original_statement text;

comment on column public.candidate_facts.parent_fact_id is
  '拆分或合併的來源候選原子命題，用於追溯審核歷程。';
comment on column public.candidate_facts.original_statement is
  '使用者修正前的原始敘述，修正後核定時保存。';

create index if not exists candidate_facts_parent_idx
  on public.candidate_facts (parent_fact_id);

-- 3. review_records ---------------------------------------------------------
create table if not exists public.review_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  candidate_fact_id uuid references public.candidate_facts (id) on delete cascade,
  source_id uuid references public.sources (id) on delete cascade,
  action public.review_action not null,
  from_status public.candidate_status,
  to_status public.candidate_status,
  note text,
  changes jsonb not null default '{}'::jsonb,
  related_ids uuid[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.review_records is
  '每一次審核動作的完整紀錄：誰在什麼時候把哪一筆候選原子命題從什麼狀態改成什麼狀態、改了什麼。';

create index if not exists review_records_owner_idx
  on public.review_records (owner_id, created_at desc);
create index if not exists review_records_fact_idx
  on public.review_records (candidate_fact_id, created_at desc);
create index if not exists review_records_source_idx
  on public.review_records (source_id, created_at desc);

drop trigger if exists review_records_set_updated_at on public.review_records;
create trigger review_records_set_updated_at
  before update on public.review_records
  for each row execute function public.set_updated_at();

-- 4. RLS --------------------------------------------------------------------
alter table public.review_records enable row level security;

drop policy if exists "review_records_select_own" on public.review_records;
create policy "review_records_select_own"
  on public.review_records for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "review_records_insert_own" on public.review_records;
create policy "review_records_insert_own"
  on public.review_records for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "review_records_update_own" on public.review_records;
create policy "review_records_update_own"
  on public.review_records for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "review_records_delete_own" on public.review_records;
create policy "review_records_delete_own"
  on public.review_records for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- 5. 相似候選原子命題搜尋 ---------------------------------------------------------
-- 審核單筆原子命題時，用來提示「相似既有原子命題」，避免重複核定。
create extension if not exists "pg_trgm" with schema extensions;

create index if not exists candidate_facts_statement_trgm_idx
  on public.candidate_facts using gin (statement extensions.gin_trgm_ops);

create or replace function public.find_similar_candidates(
  p_owner uuid,
  p_statement text,
  p_exclude uuid default null,
  p_limit integer default 5
)
returns table (
  id uuid,
  statement text,
  status public.candidate_status,
  source_id uuid,
  source_paragraph_id text,
  similarity real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.statement,
    c.status,
    c.source_id,
    c.source_paragraph_id,
    extensions.similarity(c.statement, p_statement) as similarity
  from public.candidate_facts c
  where c.owner_id = p_owner
    and (p_exclude is null or c.id <> p_exclude)
    and extensions.similarity(c.statement, p_statement) > 0.3
  order by similarity desc
  limit p_limit;
$$;

grant execute on function public.find_similar_candidates(uuid, text, uuid, integer) to authenticated;
