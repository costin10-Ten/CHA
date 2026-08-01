-- =============================================================================
-- Phase 6：混合搜尋、證據包與 AI 問答
-- =============================================================================

-- 1. 問答相關列舉 ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'answer_status') then
    create type public.answer_status as enum ('draft', 'verified', 'blocked', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'sentence_verdict') then
    create type public.sentence_verdict as enum ('supported', 'partial', 'unsupported');
  end if;
end
$$;

-- 2. answer_sessions --------------------------------------------------------
create table if not exists public.answer_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  answer text,
  status public.answer_status not null default 'draft',
  insufficient_evidence boolean not null default false,
  evidence_count integer not null default 0,
  provider text,
  model text,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  model_run_id uuid references public.model_runs (id) on delete set null,
  filters jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.answer_sessions is
  '每一次 AI 問答。答案只能由 answer_evidence 中的核定事實支持。';

create index if not exists answer_sessions_owner_idx
  on public.answer_sessions (owner_id, created_at desc);

-- 3. answer_evidence --------------------------------------------------------
create table if not exists public.answer_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  answer_session_id uuid not null references public.answer_sessions (id) on delete cascade,
  knowledge_fact_id uuid not null references public.knowledge_facts (id) on delete cascade,
  knowledge_ref text not null,
  rank integer not null,
  keyword_rank real not null default 0,
  vector_similarity real not null default 0,
  combined_score real not null default 0,
  -- 快照：事實日後被修改時，仍看得到當時用了什麼
  statement text not null,
  conditions jsonb not null default '{}'::jsonb,
  source_title text,
  source_url text,
  source_locator text,
  fact_version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (answer_session_id, knowledge_fact_id)
);

comment on table public.answer_evidence is
  '送進模型的證據包內容，含當時的事實快照與來源定位。';

create index if not exists answer_evidence_session_idx
  on public.answer_evidence (answer_session_id, rank);

-- 4. answer_sentences（Phase 7 逐句驗證會填入判定結果）-------------------------
create table if not exists public.answer_sentences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  answer_session_id uuid not null references public.answer_sessions (id) on delete cascade,
  position integer not null,
  sentence text not null,
  verdict public.sentence_verdict,
  supporting_fact_ids uuid[] not null default '{}',
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (answer_session_id, position)
);

comment on table public.answer_sentences is
  '回答拆句後的逐句驗證結果。紅色（unsupported）句子不得進入最終發布稿。';

create index if not exists answer_sentences_session_idx
  on public.answer_sentences (answer_session_id, position);

-- 5. updated_at 觸發器與 RLS --------------------------------------------------
alter table public.answer_sessions enable row level security;
alter table public.answer_evidence enable row level security;
alter table public.answer_sentences enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['answer_sessions', 'answer_evidence', 'answer_sentences']
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

-- 6. 混合搜尋 ----------------------------------------------------------------
-- 同時使用：ILIKE 關鍵字、PostgreSQL 全文搜尋、三元組相似度與向量相似度，
-- 並可依文件、知識類型、風險等級與實體篩選。
-- 一律限制 owner_id 與 status = 'active'，向量只取 is_active 的現行向量。
create or replace function public.search_knowledge_facts(
  p_query text default '',
  p_embedding extensions.vector(1536) default null,
  p_source_id uuid default null,
  p_knowledge_type public.knowledge_type default null,
  p_risk_level public.risk_level default null,
  p_entity_id uuid default null,
  p_limit integer default 20,
  p_min_score real default 0.05
)
returns table (
  id uuid,
  statement text,
  subject text,
  predicate text,
  object text,
  conditions jsonb,
  knowledge_type public.knowledge_type,
  risk_level public.risk_level,
  version integer,
  source_id uuid,
  source_paragraph_id text,
  source_quote text,
  keyword_rank real,
  vector_similarity real,
  combined_score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select f.*
    from public.knowledge_facts f
    where f.owner_id = (select auth.uid())
      and f.status = 'active'
      and (p_source_id is null or f.source_id = p_source_id)
      and (p_knowledge_type is null or f.knowledge_type = p_knowledge_type)
      and (p_risk_level is null or f.risk_level = p_risk_level)
      and (
        p_entity_id is null
        or exists (
          select 1
          from public.relations r
          where r.knowledge_fact_id = f.id
            and (r.subject_entity_id = p_entity_id or r.object_entity_id = p_entity_id)
        )
      )
  ),
  scored as (
    select
      b.*,
      -- 關鍵字：中文在 simple 設定下不會斷詞，因此同時用 ILIKE 與三元組相似度補足
      greatest(
        case
          when coalesce(btrim(p_query), '') = '' then 0
          when b.statement ilike '%' || p_query || '%' then 1.0
          else 0
        end,
        case
          when coalesce(btrim(p_query), '') = '' then 0
          else coalesce(
            ts_rank_cd(
              to_tsvector('simple', b.statement),
              plainto_tsquery('simple', p_query)
            ),
            0
          )
        end,
        case
          when coalesce(btrim(p_query), '') = '' then 0
          else coalesce(extensions.similarity(b.statement, p_query), 0)
        end
      )::real as keyword_rank,
      case
        when p_embedding is null then 0
        else coalesce(
          (
            select (1 - (e.embedding <=> p_embedding))::real
            from public.embedding_records e
            where e.knowledge_fact_id = b.id
              and e.is_active
            order by e.embedding <=> p_embedding
            limit 1
          ),
          0
        )
      end::real as vector_similarity
    from base b
  )
  select
    s.id,
    s.statement,
    s.subject,
    s.predicate,
    s.object,
    s.conditions,
    s.knowledge_type,
    s.risk_level,
    s.version,
    s.source_id,
    s.source_paragraph_id,
    s.source_quote,
    s.keyword_rank,
    s.vector_similarity,
    (
      case when p_embedding is null then s.keyword_rank
      else (0.5 * s.keyword_rank + 0.5 * s.vector_similarity)
      end
    )::real as combined_score
  from scored s
  where
    -- 沒有給查詢條件時列出全部（供瀏覽用）
    (coalesce(btrim(p_query), '') = '' and p_embedding is null)
    or (
      case when p_embedding is null then s.keyword_rank
      else (0.5 * s.keyword_rank + 0.5 * s.vector_similarity)
      end
    ) >= p_min_score
  order by combined_score desc, s.created_at desc
  limit p_limit;
$$;

grant execute on function public.search_knowledge_facts(
  text, extensions.vector, uuid, public.knowledge_type, public.risk_level, uuid, integer, real
) to authenticated;
