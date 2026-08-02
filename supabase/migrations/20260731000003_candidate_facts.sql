-- =============================================================================
-- Phase 3：候選原子命題、提示詞版本與模型呼叫紀錄
-- =============================================================================

-- 1. 列舉型別 ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'knowledge_type') then
    create type public.knowledge_type as enum (
      'substance', 'concept', 'policy', 'event', 'topic', 'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'risk_level') then
    create type public.risk_level as enum ('low', 'medium', 'high');
  end if;
  if not exists (select 1 from pg_type where typname = 'candidate_status') then
    create type public.candidate_status as enum (
      'pending', 'approved', 'rejected', 'needs_fix', 'merged', 'split'
    );
  end if;
end
$$;

-- 2. prompt_versions --------------------------------------------------------
create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  version integer not null default 1,
  purpose text not null,
  template text not null,
  checksum text not null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, name, checksum)
);

comment on table public.prompt_versions is
  '提示詞版本。同一名稱的提示詞內容有變動就是新版本，供追溯每筆原子命題由哪一版產生。';

-- 3. model_runs -------------------------------------------------------------
create table if not exists public.model_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.processing_jobs (id) on delete set null,
  source_id uuid references public.sources (id) on delete cascade,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  purpose text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  status text not null default 'completed',
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.model_runs is '每一次模型呼叫的用量與延遲紀錄，供 Dashboard 與成本檢視。';

create index if not exists model_runs_owner_idx
  on public.model_runs (owner_id, created_at desc);

-- 4. candidate_facts --------------------------------------------------------
create table if not exists public.candidate_facts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  source_version_id uuid not null references public.source_versions (id) on delete cascade,
  document_chunk_id uuid references public.document_chunks (id) on delete set null,

  statement text not null,
  subject text,
  predicate text,
  object text,
  knowledge_type public.knowledge_type not null default 'other',
  conditions jsonb not null default '{}'::jsonb,

  source_quote text not null,
  source_paragraph_id text not null,
  risk_level public.risk_level not null default 'low',
  confidence numeric(3, 2) not null default 0,

  status public.candidate_status not null default 'pending',
  quality_flags text[] not null default '{}',
  quality_score integer not null default 100,
  duplicate_of uuid references public.candidate_facts (id) on delete set null,
  contradicts uuid[] not null default '{}',

  statement_hash text not null,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  model_run_id uuid references public.model_runs (id) on delete set null,
  extraction_batch text,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.candidate_facts is
  'AI 拆出的候選原子命題。必須附原文片段與段落編號；未經人工核定不得成為正式原子命題。';
comment on column public.candidate_facts.quality_flags is
  '自動品質檢查標記，例如 multi_proposition、condition_lost、certainty_escalated。';

create index if not exists candidate_facts_owner_idx
  on public.candidate_facts (owner_id, created_at desc);
create index if not exists candidate_facts_source_idx
  on public.candidate_facts (source_id, status);
create index if not exists candidate_facts_status_idx
  on public.candidate_facts (owner_id, status, risk_level);
create index if not exists candidate_facts_version_idx
  on public.candidate_facts (source_version_id, source_paragraph_id);
-- 同一版本內相同敘述視為重複，避免重跑抽取時灌入大量副本。
create unique index if not exists candidate_facts_unique_statement
  on public.candidate_facts (source_version_id, statement_hash);

-- 5. updated_at 觸發器 -------------------------------------------------------
drop trigger if exists prompt_versions_set_updated_at on public.prompt_versions;
create trigger prompt_versions_set_updated_at
  before update on public.prompt_versions
  for each row execute function public.set_updated_at();

drop trigger if exists model_runs_set_updated_at on public.model_runs;
create trigger model_runs_set_updated_at
  before update on public.model_runs
  for each row execute function public.set_updated_at();

drop trigger if exists candidate_facts_set_updated_at on public.candidate_facts;
create trigger candidate_facts_set_updated_at
  before update on public.candidate_facts
  for each row execute function public.set_updated_at();

-- 6. RLS --------------------------------------------------------------------
alter table public.prompt_versions enable row level security;
alter table public.model_runs enable row level security;
alter table public.candidate_facts enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['prompt_versions', 'model_runs', 'candidate_facts']
  loop
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

-- 7. 取得或建立提示詞版本 -----------------------------------------------------
create or replace function public.upsert_prompt_version(
  p_owner uuid,
  p_name text,
  p_purpose text,
  p_template text,
  p_checksum text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_version integer;
begin
  select id into v_id
  from public.prompt_versions
  where owner_id = p_owner and name = p_name and checksum = p_checksum;

  if v_id is not null then
    return v_id;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.prompt_versions
  where owner_id = p_owner and name = p_name;

  insert into public.prompt_versions (owner_id, name, version, purpose, template, checksum)
  values (p_owner, p_name, v_version, p_purpose, p_template, p_checksum)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_prompt_version(uuid, text, text, text, text) from public;
grant execute on function public.upsert_prompt_version(uuid, text, text, text, text) to service_role;
