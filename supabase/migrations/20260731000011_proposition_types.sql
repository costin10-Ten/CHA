-- =============================================================================
-- 原子命題分類：從單選六類改為可複選的九類
--
-- 這九類同時涵蓋「知識內容」「事件類型」與「治理層級」三個面向，彼此本來就會
-- 重疊——例如一條講國內化學品法規如何限制某物質的命題，同時屬於
-- 「國內治理政策」與「物質與物理化學性質」。因此分類改為陣列，不強迫單選。
--
-- 空陣列是合法的，代表「未分類」，不另設「其他」類。
-- =============================================================================

-- 1. 新的列舉型別 -----------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposition_type') then
    create type public.proposition_type as enum (
      'substance_property',    -- 物質與物理化學性質
      'chemistry_concept',     -- 化學基本概念
      'event',                 -- 事件
      'agency_topic',          -- 化學署主題
      'toxicology_mechanism',  -- 毒理與反應機制
      'domestic_policy',       -- 國內治理政策
      'foreign_policy',        -- 國外治理政策
      'research_literature',   -- 研究與期刊
      'health_advice'          -- 醫學健康建議（須為政府機關來源）
    );
  end if;
end
$$;

comment on type public.proposition_type is
  '原子命題的分類，可複選。health_advice 依規定必須來自政府機關來源。';

-- 2. 加上新欄位 -------------------------------------------------------------
alter table public.candidate_facts
  add column if not exists proposition_types public.proposition_type[]
    not null default '{}';

alter table public.knowledge_facts
  add column if not exists proposition_types public.proposition_type[]
    not null default '{}';

comment on column public.candidate_facts.proposition_types is
  '原子命題分類，可複選；空陣列代表未分類。';
comment on column public.knowledge_facts.proposition_types is
  '原子命題分類，可複選；空陣列代表未分類。';

-- 3. 舊資料對應 -------------------------------------------------------------
-- 舊的六類是單選，只能給出近似的對應；'other' 對應成未分類（空陣列），
-- 讓它在畫面上明顯是「還沒分類」，而不是被塞進某一個看似合理的類別。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_facts'
      and column_name = 'knowledge_type'
  ) then
    execute $sql$
      update public.candidate_facts set proposition_types = case knowledge_type
        when 'substance' then array['substance_property']::public.proposition_type[]
        when 'concept'   then array['chemistry_concept']::public.proposition_type[]
        when 'policy'    then array['domestic_policy']::public.proposition_type[]
        when 'event'     then array['event']::public.proposition_type[]
        when 'topic'     then array['agency_topic']::public.proposition_type[]
        else '{}'::public.proposition_type[]
      end
      where proposition_types = '{}'::public.proposition_type[]
    $sql$;

    execute $sql$
      update public.knowledge_facts set proposition_types = case knowledge_type
        when 'substance' then array['substance_property']::public.proposition_type[]
        when 'concept'   then array['chemistry_concept']::public.proposition_type[]
        when 'policy'    then array['domestic_policy']::public.proposition_type[]
        when 'event'     then array['event']::public.proposition_type[]
        when 'topic'     then array['agency_topic']::public.proposition_type[]
        else '{}'::public.proposition_type[]
      end
      where proposition_types = '{}'::public.proposition_type[]
    $sql$;
  end if;
end
$$;

-- 4. 索引 -------------------------------------------------------------------
-- 陣列的包含查詢（`@>`、`&&`）需要 GIN。
create index if not exists candidate_facts_proposition_types_idx
  on public.candidate_facts using gin (proposition_types);
create index if not exists knowledge_facts_proposition_types_idx
  on public.knowledge_facts using gin (proposition_types);

-- 5. 實體的類型 -------------------------------------------------------------
-- 實體是從命題的主體／客體整理出來的，它的類型沿用命題的第一個分類。
-- 命題未分類時實體類型為 null，不硬塞一個值。
alter table public.entities
  add column if not exists primary_type public.proposition_type;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'entities'
      and column_name = 'entity_type'
  ) then
    execute $sql$
      update public.entities set primary_type = case entity_type
        when 'substance' then 'substance_property'::public.proposition_type
        when 'concept'   then 'chemistry_concept'::public.proposition_type
        when 'policy'    then 'domestic_policy'::public.proposition_type
        when 'event'     then 'event'::public.proposition_type
        when 'topic'     then 'agency_topic'::public.proposition_type
        else null
      end
      where primary_type is null
    $sql$;
  end if;
end
$$;

-- 6. 重建相依的函式 ---------------------------------------------------------
-- 舊簽章帶著 knowledge_type，必須先丟掉才能拿掉型別。

drop function if exists public.upsert_entity(uuid, text, public.knowledge_type);

create or replace function public.upsert_entity(
  p_owner uuid,
  p_name text,
  p_type public.proposition_type default null
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

  insert into public.entities (owner_id, name, normalized_name, primary_type)
  values (p_owner, btrim(p_name), v_normalized, p_type)
  on conflict (owner_id, normalized_name)
  do update set
    fact_count = public.entities.fact_count + 1,
    -- 既有實體已經有類型就不覆蓋；原本沒有才補上。
    primary_type = coalesce(public.entities.primary_type, excluded.primary_type)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.upsert_entity(uuid, text, public.proposition_type)
  to authenticated;

-- 核定：候選原子命題 → 正式原子命題。
-- 與原版逐行相同，只有分類欄位從 knowledge_type 改成 proposition_types，
-- 以及訊息中的「原子命題」改成「原子命題」。其餘防呆、去重與排程一律保留。
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
  v_primary public.proposition_type;
begin
  select * into v_candidate
  from public.candidate_facts
  where id = p_candidate_id and owner_id = (select auth.uid());

  if not found then
    raise exception '找不到候選原子命題或無權限';
  end if;

  if v_candidate.status <> 'approved' then
    raise exception '只有已核定的候選原子命題可以寫入正式命題庫';
  end if;

  if coalesce(btrim(v_candidate.source_quote), '') = '' then
    raise exception '缺少原文片段的原子命題不得寫入正式命題庫';
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

  -- 實體類型沿用命題的第一個分類；未分類時為 null。
  v_primary := v_candidate.proposition_types[1];

  insert into public.knowledge_facts (
    owner_id, source_id, source_version_id, candidate_fact_id,
    source_paragraph_id, source_quote, statement, subject, predicate, object,
    proposition_types, conditions, risk_level, statement_hash, status, version
  )
  values (
    v_candidate.owner_id, v_candidate.source_id, v_candidate.source_version_id,
    v_candidate.id, v_candidate.source_paragraph_id, v_candidate.source_quote,
    v_candidate.statement, v_candidate.subject, v_candidate.predicate, v_candidate.object,
    v_candidate.proposition_types, v_candidate.conditions, v_candidate.risk_level,
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
    v_candidate.owner_id, v_candidate.subject, v_primary
  );
  v_object_id := public.upsert_entity(
    v_candidate.owner_id, v_candidate.object, v_primary
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

-- 混合搜尋：分類篩選改成陣列包含判斷，其餘與原版逐行相同。
drop function if exists public.search_knowledge_facts(
  text, extensions.vector, uuid, public.knowledge_type, public.risk_level,
  uuid, integer, real
);

create or replace function public.search_knowledge_facts(
  p_query text default '',
  p_embedding extensions.vector(1536) default null,
  p_source_id uuid default null,
  p_proposition_type public.proposition_type default null,
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
  proposition_types public.proposition_type[],
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
      -- 命題可以有多個分類，篩選是「包含這一類」而不是「等於這一類」。
      and (
        p_proposition_type is null
        or f.proposition_types operator(pg_catalog.@>) array[p_proposition_type]
      )
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
            -- 函式設了 search_path = ''，pgvector 的 <=> 運算子必須明確指定 schema，
            -- 否則會出現 42883 operator does not exist。
            select (1 - (e.embedding operator(extensions.<=>) p_embedding))::real
            from public.embedding_records e
            where e.knowledge_fact_id = b.id
              and e.is_active
            order by e.embedding operator(extensions.<=>) p_embedding
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
    s.proposition_types,
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
  text, extensions.vector, uuid, public.proposition_type, public.risk_level,
  uuid, integer, real
) to authenticated;

-- 修訂正式原子命題：與原版逐行相同，只有 knowledge_type 改成 proposition_types。
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
    proposition_types, conditions, risk_level, tags, statement_hash,
    status, version, supersedes
  )
  values (
    v_old.owner_id, v_old.source_id, v_old.source_version_id, v_old.candidate_fact_id,
    v_old.source_paragraph_id, v_old.source_quote, p_statement, v_old.subject,
    v_old.predicate, v_old.object, v_old.proposition_types,
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

  -- 只停用這一筆命題的舊向量，其他命題的索引完全不動。
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

-- 7. 移除舊欄位與舊型別 -----------------------------------------------------
alter table public.candidate_facts drop column if exists knowledge_type;
alter table public.knowledge_facts drop column if exists knowledge_type;
alter table public.entities drop column if exists entity_type;

drop type if exists public.knowledge_type;
