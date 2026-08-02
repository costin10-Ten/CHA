-- =============================================================================
-- Phase 5：正式原子命題庫、版本管理、實體與關聯、pgvector 增量索引
-- =============================================================================

-- 1. 列舉型別 ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'fact_status') then
    create type public.fact_status as enum ('draft', 'active', 'inactive', 'superseded');
  end if;
end
$$;

-- 2. knowledge_facts --------------------------------------------------------
create table if not exists public.knowledge_facts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- 來源溯源：正式原子命題一定要能回到原文
  source_id uuid not null references public.sources (id) on delete cascade,
  source_version_id uuid not null references public.source_versions (id) on delete cascade,
  candidate_fact_id uuid references public.candidate_facts (id) on delete set null,
  source_paragraph_id text not null,
  source_quote text not null,

  statement text not null,
  subject text,
  predicate text,
  object text,
  knowledge_type public.knowledge_type not null default 'other',
  conditions jsonb not null default '{}'::jsonb,
  risk_level public.risk_level not null default 'low',
  tags text[] not null default '{}',

  status public.fact_status not null default 'active',
  version integer not null default 1,
  supersedes uuid references public.knowledge_facts (id) on delete set null,
  superseded_by uuid references public.knowledge_facts (id) on delete set null,

  statement_hash text not null,
  approved_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.knowledge_facts is
  '經人工核定的正式原子命題。修改時建立新版本並把舊版標為 superseded，歷史完整保留。';
comment on column public.knowledge_facts.supersedes is '本版取代的舊版原子命題。';

create index if not exists knowledge_facts_owner_idx
  on public.knowledge_facts (owner_id, created_at desc);
create index if not exists knowledge_facts_status_idx
  on public.knowledge_facts (owner_id, status, risk_level);
create index if not exists knowledge_facts_source_idx
  on public.knowledge_facts (source_id, status);
create index if not exists knowledge_facts_fts_idx
  on public.knowledge_facts using gin (to_tsvector('simple', statement));
create index if not exists knowledge_facts_trgm_idx
  on public.knowledge_facts using gin (statement extensions.gin_trgm_ops);
-- 同一位使用者的現行原子命題不得重複。
create unique index if not exists knowledge_facts_active_statement_key
  on public.knowledge_facts (owner_id, statement_hash)
  where status = 'active';

-- 3. fact_versions ----------------------------------------------------------
create table if not exists public.fact_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  knowledge_fact_id uuid not null references public.knowledge_facts (id) on delete cascade,
  version integer not null,
  statement text not null,
  conditions jsonb not null default '{}'::jsonb,
  risk_level public.risk_level not null default 'low',
  source_quote text not null,
  change_note text,
  changed_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (knowledge_fact_id, version)
);

comment on table public.fact_versions is '正式原子命題的每一版快照，供追溯內容變動。';

-- 4. entities ---------------------------------------------------------------
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  entity_type public.knowledge_type not null default 'other',
  aliases text[] not null default '{}',
  description text,
  fact_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, normalized_name)
);

comment on table public.entities is '從正式原子命題的主體與客體整理出的實體。';

create index if not exists entities_owner_idx on public.entities (owner_id, name);

-- 5. relations --------------------------------------------------------------
create table if not exists public.relations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  subject_entity_id uuid not null references public.entities (id) on delete cascade,
  object_entity_id uuid references public.entities (id) on delete cascade,
  predicate text not null,
  knowledge_fact_id uuid references public.knowledge_facts (id) on delete cascade,
  confidence numeric(3, 2) not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, subject_entity_id, predicate, object_entity_id, knowledge_fact_id)
);

comment on table public.relations is '實體之間的關聯，每一筆都指向支持它的正式原子命題。';

create index if not exists relations_owner_idx on public.relations (owner_id);
create index if not exists relations_subject_idx on public.relations (subject_entity_id);

-- 6. embedding_records ------------------------------------------------------
create table if not exists public.embedding_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  knowledge_fact_id uuid not null references public.knowledge_facts (id) on delete cascade,
  fact_version integer not null default 1,
  embedding extensions.vector(1536),
  embedding_model text not null,
  embedding_version text not null default 'v1',
  content_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.embedding_records is
  '原子命題向量。修改原子命題時只停用該筆的舊向量並產生新向量，不重建全部索引。';

create index if not exists embedding_records_fact_idx
  on public.embedding_records (knowledge_fact_id, is_active);
create index if not exists embedding_records_active_idx
  on public.embedding_records (owner_id, is_active);
-- 只對現行向量建立近似最近鄰索引。
create index if not exists embedding_records_vector_idx
  on public.embedding_records using hnsw (embedding extensions.vector_cosine_ops)
  where is_active;

-- 7. updated_at 觸發器 -------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'knowledge_facts', 'fact_versions', 'entities', 'relations', 'embedding_records'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end
$$;

-- 8. RLS --------------------------------------------------------------------
-- 明確逐張啟用，讓「每張表都有 RLS」在原始碼中一眼可查（單元測試也會檢查）。
alter table public.knowledge_facts enable row level security;
alter table public.fact_versions enable row level security;
alter table public.entities enable row level security;
alter table public.relations enable row level security;
alter table public.embedding_records enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'knowledge_facts', 'fact_versions', 'entities', 'relations', 'embedding_records'
  ]
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

-- 9. 實體整理 ---------------------------------------------------------------
create or replace function public.normalize_entity_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(p_name, ''), '\s+', '', 'g'));
$$;

create or replace function public.upsert_entity(
  p_owner uuid,
  p_name text,
  p_type public.knowledge_type default 'other'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_normalized text;
begin
  if p_name is null or btrim(p_name) = '' then
    return null;
  end if;

  v_normalized := public.normalize_entity_name(p_name);

  insert into public.entities (owner_id, name, normalized_name, entity_type)
  values (p_owner, btrim(p_name), v_normalized, p_type)
  on conflict (owner_id, normalized_name)
  do update set fact_count = public.entities.fact_count + 1
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.upsert_entity(uuid, text, public.knowledge_type) to authenticated;
grant execute on function public.normalize_entity_name(text) to authenticated;

-- 10. 核定候選原子命題 → 正式原子命題 -------------------------------------------------
create or replace function public.promote_candidate_fact(p_candidate_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate public.candidate_facts;
  v_fact_id uuid;
  v_subject_id uuid;
  v_object_id uuid;
begin
  select * into v_candidate
  from public.candidate_facts
  where id = p_candidate_id and owner_id = (select auth.uid());

  if not found then
    raise exception '找不到候選原子命題或無權限';
  end if;

  if v_candidate.status <> 'approved' then
    raise exception '只有已核定的候選原子命題可以寫入正式原子命題庫';
  end if;

  if coalesce(btrim(v_candidate.source_quote), '') = '' then
    raise exception '缺少原文片段的原子命題不得寫入正式原子命題庫';
  end if;

  -- 已經轉過就直接回傳既有的正式原子命題。
  select id into v_fact_id
  from public.knowledge_facts
  where owner_id = v_candidate.owner_id
    and candidate_fact_id = v_candidate.id
    and status <> 'superseded'
  limit 1;

  if v_fact_id is not null then
    return v_fact_id;
  end if;

  insert into public.knowledge_facts (
    owner_id, source_id, source_version_id, candidate_fact_id,
    source_paragraph_id, source_quote, statement, subject, predicate, object,
    knowledge_type, conditions, risk_level, statement_hash, status, version
  )
  values (
    v_candidate.owner_id, v_candidate.source_id, v_candidate.source_version_id,
    v_candidate.id, v_candidate.source_paragraph_id, v_candidate.source_quote,
    v_candidate.statement, v_candidate.subject, v_candidate.predicate, v_candidate.object,
    v_candidate.knowledge_type, v_candidate.conditions, v_candidate.risk_level,
    v_candidate.statement_hash, 'active', 1
  )
  on conflict (owner_id, statement_hash) where status = 'active'
  do nothing
  returning id into v_fact_id;

  -- 內容重複時沿用既有的現行原子命題。
  if v_fact_id is null then
    select id into v_fact_id
    from public.knowledge_facts
    where owner_id = v_candidate.owner_id
      and statement_hash = v_candidate.statement_hash
      and status = 'active'
    limit 1;
    return v_fact_id;
  end if;

  insert into public.fact_versions (
    owner_id, knowledge_fact_id, version, statement, conditions,
    risk_level, source_quote, change_note
  )
  values (
    v_candidate.owner_id, v_fact_id, 1, v_candidate.statement, v_candidate.conditions,
    v_candidate.risk_level, v_candidate.source_quote, '由候選原子命題核定建立'
  );

  -- 主體與客體整理成實體，並建立關聯。
  v_subject_id := public.upsert_entity(
    v_candidate.owner_id, v_candidate.subject, v_candidate.knowledge_type
  );
  v_object_id := public.upsert_entity(
    v_candidate.owner_id, v_candidate.object, v_candidate.knowledge_type
  );

  if v_subject_id is not null and coalesce(btrim(v_candidate.predicate), '') <> '' then
    insert into public.relations (
      owner_id, subject_entity_id, object_entity_id, predicate, knowledge_fact_id
    )
    values (
      v_candidate.owner_id, v_subject_id, v_object_id,
      btrim(v_candidate.predicate), v_fact_id
    )
    on conflict do nothing;
  end if;

  -- 排入向量產生工作（只針對這一筆）。
  insert into public.processing_jobs (owner_id, job_type, source_id, payload)
  values (
    v_candidate.owner_id, 'generate_embeddings', v_candidate.source_id,
    jsonb_build_object('knowledge_fact_id', v_fact_id)
  );

  return v_fact_id;
end;
$$;

grant execute on function public.promote_candidate_fact(uuid) to authenticated;

-- 11. 修改正式原子命題：建立新版並停用舊向量 ---------------------------------------
create or replace function public.revise_knowledge_fact(
  p_fact_id uuid,
  p_statement text,
  p_conditions jsonb default null,
  p_risk_level public.risk_level default null,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.knowledge_facts;
  v_new_id uuid;
  v_hash text;
begin
  select * into v_old
  from public.knowledge_facts
  where id = p_fact_id and owner_id = (select auth.uid());

  if not found then
    raise exception '找不到正式原子命題或無權限';
  end if;

  if v_old.status = 'superseded' then
    raise exception '已被取代的版本不可再修改';
  end if;

  v_hash := encode(extensions.digest(regexp_replace(p_statement, '\s+', '', 'g'), 'sha256'), 'hex');

  insert into public.knowledge_facts (
    owner_id, source_id, source_version_id, candidate_fact_id,
    source_paragraph_id, source_quote, statement, subject, predicate, object,
    knowledge_type, conditions, risk_level, tags, statement_hash,
    status, version, supersedes
  )
  values (
    v_old.owner_id, v_old.source_id, v_old.source_version_id, v_old.candidate_fact_id,
    v_old.source_paragraph_id, v_old.source_quote, p_statement, v_old.subject,
    v_old.predicate, v_old.object, v_old.knowledge_type,
    coalesce(p_conditions, v_old.conditions), coalesce(p_risk_level, v_old.risk_level),
    v_old.tags, v_hash, 'active', v_old.version + 1, v_old.id
  )
  returning id into v_new_id;

  update public.knowledge_facts
  set status = 'superseded', superseded_by = v_new_id
  where id = v_old.id;

  insert into public.fact_versions (
    owner_id, knowledge_fact_id, version, statement, conditions,
    risk_level, source_quote, change_note, changed_fields
  )
  values (
    v_old.owner_id, v_new_id, v_old.version + 1, p_statement,
    coalesce(p_conditions, v_old.conditions), coalesce(p_risk_level, v_old.risk_level),
    v_old.source_quote, p_note,
    jsonb_build_object('statement', jsonb_build_object('from', v_old.statement, 'to', p_statement))
  );

  -- 只停用這一筆原子命題的舊向量，其他原子命題的索引完全不動。
  update public.embedding_records
  set is_active = false
  where knowledge_fact_id = v_old.id and is_active;

  -- 只為新版本排入一筆向量工作。
  insert into public.processing_jobs (owner_id, job_type, source_id, payload)
  values (
    v_old.owner_id, 'generate_embeddings', v_old.source_id,
    jsonb_build_object('knowledge_fact_id', v_new_id)
  );

  return v_new_id;
end;
$$;

grant execute on function public.revise_knowledge_fact(uuid, text, jsonb, public.risk_level, text) to authenticated;

-- 12. 停用／恢復正式原子命題 -------------------------------------------------------
create or replace function public.set_knowledge_fact_status(
  p_fact_id uuid,
  p_status public.fact_status
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('active', 'inactive') then
    raise exception '只能切換 active 與 inactive';
  end if;

  update public.knowledge_facts
  set status = p_status
  where id = p_fact_id and owner_id = (select auth.uid()) and status <> 'superseded';

  -- 停用原子命題時，其向量一併退出搜尋。
  update public.embedding_records
  set is_active = (p_status = 'active')
  where knowledge_fact_id = p_fact_id
    and owner_id = (select auth.uid())
    and fact_version = (
      select version from public.knowledge_facts where id = p_fact_id
    );
end;
$$;

grant execute on function public.set_knowledge_fact_status(uuid, public.fact_status) to authenticated;

-- 13. pgcrypto digest 需要在 extensions schema 可用 ----------------------------
create extension if not exists "pgcrypto" with schema extensions;
