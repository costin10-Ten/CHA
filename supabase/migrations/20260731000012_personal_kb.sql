-- =============================================================================
-- 個人原子知識庫（Personal Knowledge Base）
--
-- 與 CHA 風險溝通系統共用同一個 Supabase 專案，因此所有物件加上 pkb_ 前綴。
-- 兩套系統的規則刻意不同，不共用資料表：
--
--   CHA：引句必須逐字存在於來源文件的某一段，AI 抽取 + 人工核定
--   PKB：只要標註來源就可以進正式知識，外部匯入 + 人工同意
--
-- 因為沒有 AI 抽取，也就不需要「候選」與「正式」兩張表——
-- 匯入的內容已經是使用者自己整理好的，用 status 一個欄位區分即可。
-- =============================================================================

-- 1. 列舉型別 ---------------------------------------------------------------

-- 九類來源分類。這是「出處」而不是「內容」，所以單選。
-- 分不進這九類時填 other，並在 source_label／source_note 說明實際來源。
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pkb_source_type') then
    create type public.pkb_source_type as enum (
      'popular_science',     -- 科普文章
      'domestic_law',        -- 國內法規
      'own_duty',            -- 本署業務
      'moenv_news',          -- 環境部新聞
      'foreign_regulation',  -- 國外管理制度
      'foreign_news',        -- 國外最新新聞
      'ministry_priority',   -- 本部重點推動
      'mock_question',       -- 模擬題（自製）
      'formal_idea',         -- 正式發想點（自製）
      'other'                -- 其他，須在 source_label 說明
    );
  end if;
end
$$;

comment on type public.pkb_source_type is
  '個人原子知識的來源分類，單選。mock_question 與 formal_idea 是自製內容，不是外部文獻。';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pkb_status') then
    create type public.pkb_status as enum ('draft', 'active', 'trashed');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pkb_action') then
    create type public.pkb_action as enum (
      'import', 'approve', 'edit', 'trash', 'restore'
    );
  end if;
end
$$;

-- 2. 匯入批次 ---------------------------------------------------------------
create table if not exists public.pkb_import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  filename text,
  item_count integer not null default 0,
  skipped_count integer not null default 0,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.pkb_import_batches is
  '一次匯入的紀錄，用來追溯某一筆知識是哪一份檔案帶進來的。';

create index if not exists pkb_import_batches_owner_idx
  on public.pkb_import_batches (owner_id, created_at desc);

-- 3. 原子知識 ---------------------------------------------------------------
create table if not exists public.pkb_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  import_batch_id uuid references public.pkb_import_batches (id) on delete set null,

  statement text not null,

  -- 來源：這一版沒有原文比對，可信度完全由這幾個欄位承擔，所以分類與名稱必填。
  source_type public.pkb_source_type not null,
  source_label text not null,
  source_url text,
  source_note text,
  -- 模擬題與正式發想點是自己寫的，不是外部依據。
  -- 供其他 LLM 問答時要能區分，否則自己的發想會被當成既有事實引用回來。
  is_self_authored boolean not null default false,

  -- 圖譜用，有填才會建立實體與關聯。
  subject text,
  predicate text,
  object text,

  tags text[] not null default '{}',

  status public.pkb_status not null default 'draft',
  approved_at timestamptz,
  trashed_at timestamptz,
  trash_reason text,

  statement_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- 狀態與時間戳必須一致，避免出現「已同意但沒有同意時間」這種讀不懂的資料。
  constraint pkb_items_status_timestamps check (
    (status = 'active') = (approved_at is not null)
    and (status = 'trashed') = (trashed_at is not null)
  ),
  constraint pkb_items_statement_not_blank check (btrim(statement) <> ''),
  constraint pkb_items_source_label_not_blank check (btrim(source_label) <> '')
);

comment on table public.pkb_items is
  '個人原子知識。draft 待同意、active 已同意（進入向量與搜尋）、trashed 在垃圾桶。';
comment on column public.pkb_items.is_self_authored is
  '自製內容（模擬題、正式發想點）。匯出給其他 LLM 時會明確標示，避免被當成外部依據。';

create index if not exists pkb_items_owner_status_idx
  on public.pkb_items (owner_id, status, created_at desc);
create index if not exists pkb_items_source_type_idx
  on public.pkb_items (owner_id, source_type) where status <> 'trashed';
create index if not exists pkb_items_tags_idx
  on public.pkb_items using gin (tags);
create index if not exists pkb_items_fts_idx
  on public.pkb_items using gin (to_tsvector('simple', statement));
create index if not exists pkb_items_trgm_idx
  on public.pkb_items using gin (statement extensions.gin_trgm_ops);

-- 同一句話不重複收。垃圾桶裡的不算，才能「丟掉之後重新匯入」。
create unique index if not exists pkb_items_statement_key
  on public.pkb_items (owner_id, statement_hash)
  where status <> 'trashed';

-- 4. 審核歷程 ---------------------------------------------------------------
create table if not exists public.pkb_review_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.pkb_items (id) on delete cascade,
  action public.pkb_action not null,
  from_status public.pkb_status,
  to_status public.pkb_status,
  note text,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists pkb_review_log_item_idx
  on public.pkb_review_log (item_id, created_at desc);
create index if not exists pkb_review_log_owner_idx
  on public.pkb_review_log (owner_id, created_at desc);

-- 5. 實體與關聯（圖譜）-------------------------------------------------------
create table if not exists public.pkb_entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  item_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, normalized_name)
);

create table if not exists public.pkb_relations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  subject_entity_id uuid not null references public.pkb_entities (id) on delete cascade,
  object_entity_id uuid references public.pkb_entities (id) on delete cascade,
  predicate text not null,
  item_id uuid references public.pkb_items (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, subject_entity_id, predicate, object_entity_id, item_id)
);

create index if not exists pkb_relations_subject_idx
  on public.pkb_relations (subject_entity_id);
create index if not exists pkb_relations_object_idx
  on public.pkb_relations (object_entity_id);

-- 6. 向量 -------------------------------------------------------------------
create table if not exists public.pkb_embeddings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.pkb_items (id) on delete cascade,
  embedding extensions.vector(1536),
  embedding_model text not null,
  content_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.pkb_embeddings is
  '個人原子知識的向量。改一筆只停用該筆舊向量並產生新的，不重建整個索引。';

create index if not exists pkb_embeddings_item_idx
  on public.pkb_embeddings (item_id, is_active);
-- 只對現行向量建立近似最近鄰索引。
create index if not exists pkb_embeddings_vector_idx
  on public.pkb_embeddings using hnsw (embedding extensions.vector_cosine_ops)
  where is_active;

-- 7. RLS --------------------------------------------------------------------
-- 逐張明寫，不放進迴圈：這一行是安全防線，要能直接 grep 得到，
-- tests/unit/migrations.test.ts 也是照字面檢查的。
alter table public.pkb_import_batches enable row level security;
alter table public.pkb_items enable row level security;
alter table public.pkb_review_log enable row level security;
alter table public.pkb_entities enable row level security;
alter table public.pkb_relations enable row level security;
alter table public.pkb_embeddings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'pkb_import_batches', 'pkb_items', 'pkb_review_log',
    'pkb_entities', 'pkb_relations', 'pkb_embeddings'
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

-- 8. 更新時間戳 -------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'pkb_import_batches', 'pkb_items', 'pkb_review_log',
    'pkb_entities', 'pkb_relations', 'pkb_embeddings'
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

-- 9. 實體整理 ---------------------------------------------------------------
create or replace function public.pkb_upsert_entity(p_owner uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    return null;
  end if;

  insert into public.pkb_entities (owner_id, name, normalized_name, item_count)
  values (
    p_owner, btrim(p_name), public.normalize_entity_name(p_name), 1
  )
  on conflict (owner_id, normalized_name)
  do update set item_count = public.pkb_entities.item_count + 1
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.pkb_upsert_entity(uuid, text) to authenticated;

-- 10. 同意 ------------------------------------------------------------------
-- draft → active：建立實體與關聯，並排入向量工作。
create or replace function public.pkb_approve_item(p_item_id uuid, p_note text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.pkb_items;
  v_subject uuid;
  v_object uuid;
begin
  select * into v_item
  from public.pkb_items
  where id = p_item_id and owner_id = (select auth.uid());

  if not found then
    raise exception '找不到這筆原子知識或無權限';
  end if;

  if v_item.status = 'active' then
    return v_item.id;
  end if;

  if v_item.status = 'trashed' then
    raise exception '垃圾桶裡的原子知識要先還原才能同意';
  end if;

  update public.pkb_items
  set status = 'active', approved_at = timezone('utc', now())
  where id = p_item_id;

  insert into public.pkb_review_log (owner_id, item_id, action, from_status, to_status, note)
  values (v_item.owner_id, p_item_id, 'approve', v_item.status, 'active', p_note);

  -- 圖譜：主體與客體有填才建立。
  v_subject := public.pkb_upsert_entity(v_item.owner_id, v_item.subject);
  v_object := public.pkb_upsert_entity(v_item.owner_id, v_item.object);

  if v_subject is not null and coalesce(btrim(v_item.predicate), '') <> '' then
    insert into public.pkb_relations (
      owner_id, subject_entity_id, object_entity_id, predicate, item_id
    )
    values (
      v_item.owner_id, v_subject, v_object, btrim(v_item.predicate), p_item_id
    )
    on conflict do nothing;
  end if;

  return p_item_id;
end;
$$;

grant execute on function public.pkb_approve_item(uuid, text) to authenticated;

-- 11. 丟垃圾桶／還原 --------------------------------------------------------
-- 不硬刪：硬刪之後同一筆會在下次匯入時再出現，而且沒有紀錄說明當初為什麼不要。
create or replace function public.pkb_trash_item(p_item_id uuid, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.pkb_items;
begin
  select * into v_item
  from public.pkb_items
  where id = p_item_id and owner_id = (select auth.uid());

  if not found then
    raise exception '找不到這筆原子知識或無權限';
  end if;
  if v_item.status = 'trashed' then
    return;
  end if;

  update public.pkb_items
  set status = 'trashed',
      trashed_at = timezone('utc', now()),
      trash_reason = p_reason,
      approved_at = null
  where id = p_item_id;

  -- 進垃圾桶就退出搜尋：停用向量、移除關聯。實體本身留著，別的知識可能還在用。
  update public.pkb_embeddings
  set is_active = false
  where item_id = p_item_id and is_active;

  delete from public.pkb_relations where item_id = p_item_id;

  insert into public.pkb_review_log (owner_id, item_id, action, from_status, to_status, note)
  values (v_item.owner_id, p_item_id, 'trash', v_item.status, 'trashed', p_reason);
end;
$$;

grant execute on function public.pkb_trash_item(uuid, text) to authenticated;

create or replace function public.pkb_restore_item(p_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.pkb_items;
begin
  select * into v_item
  from public.pkb_items
  where id = p_item_id and owner_id = (select auth.uid());

  if not found then
    raise exception '找不到這筆原子知識或無權限';
  end if;
  if v_item.status <> 'trashed' then
    return;
  end if;

  -- 還原成待同意，不直接回到已同意：既然丟過一次，就該再看一眼。
  update public.pkb_items
  set status = 'draft', trashed_at = null, trash_reason = null
  where id = p_item_id;

  insert into public.pkb_review_log (owner_id, item_id, action, from_status, to_status)
  values (v_item.owner_id, p_item_id, 'restore', 'trashed', 'draft');
end;
$$;

grant execute on function public.pkb_restore_item(uuid) to authenticated;

-- 12. 搜尋 ------------------------------------------------------------------
-- 關鍵字（ILIKE + 全文 + 三元組）與向量的混合檢索，只查已同意的知識。
create or replace function public.pkb_search(
  p_query text default '',
  p_embedding extensions.vector(1536) default null,
  p_source_type public.pkb_source_type default null,
  p_tag text default null,
  p_limit integer default 20,
  p_min_score real default 0.05
)
returns table (
  id uuid,
  statement text,
  source_type public.pkb_source_type,
  source_label text,
  source_url text,
  is_self_authored boolean,
  tags text[],
  subject text,
  predicate text,
  object text,
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
    select i.*
    from public.pkb_items i
    where i.owner_id = (select auth.uid())
      and i.status = 'active'
      and (p_source_type is null or i.source_type = p_source_type)
      and (p_tag is null or i.tags operator(pg_catalog.@>) array[p_tag])
  ),
  scored as (
    select
      b.*,
      greatest(
        case
          when coalesce(btrim(p_query), '') = '' then 0
          when b.statement ilike '%' || p_query || '%' then 1.0
          else 0
        end,
        case
          when coalesce(btrim(p_query), '') = '' then 0
          else coalesce(extensions.similarity(b.statement, p_query), 0)
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
        end
      )::real as keyword_rank,
      case
        when p_embedding is null then 0
        else coalesce(
          (
            -- 函式設了 search_path = ''，pgvector 的 <=> 必須明確指定 schema。
            select (1 - (e.embedding operator(extensions.<=>) p_embedding))::real
            from public.pkb_embeddings e
            where e.item_id = b.id and e.is_active
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
    s.source_type,
    s.source_label,
    s.source_url,
    s.is_self_authored,
    s.tags,
    s.subject,
    s.predicate,
    s.object,
    s.keyword_rank,
    s.vector_similarity,
    (0.4 * s.keyword_rank + 0.6 * s.vector_similarity)::real as combined_score
  from scored s
  where (0.4 * s.keyword_rank + 0.6 * s.vector_similarity) >= p_min_score
  order by combined_score desc, s.created_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.pkb_search(
  text, extensions.vector, public.pkb_source_type, text, integer, real
) to authenticated;
