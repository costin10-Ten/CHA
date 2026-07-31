-- =============================================================================
-- Phase 2：來源、版本、段落、背景工作與 Storage
-- =============================================================================

-- 1. 列舉型別 ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'source_type') then
    create type public.source_type as enum ('text', 'file', 'url');
  end if;
  if not exists (select 1 from pg_type where typname = 'source_status') then
    create type public.source_status as enum ('pending', 'processing', 'ready', 'failed', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'job_type') then
    create type public.job_type as enum (
      'parse_document',
      'extract_facts',
      'generate_embeddings',
      'verify_answer',
      'generate_content',
      'scheduled_update'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum (
      'pending', 'processing', 'completed', 'failed', 'retrying', 'cancelled'
    );
  end if;
end
$$;

-- 2. sources ----------------------------------------------------------------
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  source_type public.source_type not null,
  origin_url text,
  storage_path text,
  mime_type text,
  byte_size bigint,
  current_version integer not null default 0,
  content_hash text,
  status public.source_status not null default 'pending',
  last_error text,
  fetched_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.sources is '匯入的原始來源文件（貼入文字、上傳檔案或網址）。';
comment on column public.sources.content_hash is '現行版本內容的 SHA-256，用於偵測重複與判斷是否需要建立新版本。';
comment on column public.sources.storage_path is 'Storage 內原始檔路徑：{owner_id}/{source_id}/original.<ext>';

create index if not exists sources_owner_id_idx on public.sources (owner_id, created_at desc);
create index if not exists sources_status_idx on public.sources (owner_id, status);
-- 同一使用者的相同內容視為重複文件。
create unique index if not exists sources_owner_content_hash_key
  on public.sources (owner_id, content_hash)
  where content_hash is not null;

-- 3. source_versions --------------------------------------------------------
create table if not exists public.source_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  version integer not null,
  title text,
  raw_text text,
  raw_html text,
  storage_path text,
  content_hash text not null,
  parser_version text not null,
  char_count integer not null default 0,
  chunk_count integer not null default 0,
  is_current boolean not null default false,
  fetched_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source_id, version)
);

comment on table public.source_versions is '來源的每一次解析結果。舊版本保留不覆蓋，只有一筆 is_current。';

create index if not exists source_versions_source_idx
  on public.source_versions (source_id, version desc);
create unique index if not exists source_versions_one_current_key
  on public.source_versions (source_id)
  where is_current;

-- 4. document_chunks --------------------------------------------------------
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  source_version_id uuid not null references public.source_versions (id) on delete cascade,
  paragraph_id text not null,
  position integer not null,
  block_type text not null default 'paragraph',
  heading_path text[] not null default '{}',
  text text not null,
  char_start integer not null default 0,
  char_end integer not null default 0,
  content_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source_version_id, paragraph_id)
);

comment on table public.document_chunks is '解析後的段落。paragraph_id（P-001…）是事實回溯原文的定位依據。';

create index if not exists document_chunks_version_idx
  on public.document_chunks (source_version_id, position);
create index if not exists document_chunks_hash_idx
  on public.document_chunks (source_id, content_hash);
-- 全文搜尋（Phase 6 混合搜尋會用到；simple 設定對中文以字元切分，仍可命中關鍵字）
create index if not exists document_chunks_fts_idx
  on public.document_chunks using gin (to_tsvector('simple', text));

-- 5. processing_jobs --------------------------------------------------------
create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  job_type public.job_type not null,
  status public.job_status not null default 'pending',
  source_id uuid references public.sources (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  progress integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  scheduled_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  model_usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.processing_jobs is
  '背景工作佇列。以 FOR UPDATE SKIP LOCKED 認領，保存錯誤、重試次數、時間與模型用量。';

create index if not exists processing_jobs_owner_idx
  on public.processing_jobs (owner_id, created_at desc);
create index if not exists processing_jobs_due_idx
  on public.processing_jobs (status, scheduled_at)
  where status in ('pending', 'retrying');
create index if not exists processing_jobs_source_idx
  on public.processing_jobs (source_id, created_at desc);

-- 6. updated_at 觸發器 -------------------------------------------------------
drop trigger if exists sources_set_updated_at on public.sources;
create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

drop trigger if exists source_versions_set_updated_at on public.source_versions;
create trigger source_versions_set_updated_at
  before update on public.source_versions
  for each row execute function public.set_updated_at();

drop trigger if exists document_chunks_set_updated_at on public.document_chunks;
create trigger document_chunks_set_updated_at
  before update on public.document_chunks
  for each row execute function public.set_updated_at();

drop trigger if exists processing_jobs_set_updated_at on public.processing_jobs;
create trigger processing_jobs_set_updated_at
  before update on public.processing_jobs
  for each row execute function public.set_updated_at();

-- 7. RLS --------------------------------------------------------------------
alter table public.sources enable row level security;
alter table public.source_versions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.processing_jobs enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['sources', 'source_versions', 'document_chunks', 'processing_jobs']
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

-- 8. Storage bucket ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources',
  'sources',
  false,
  52428800, -- 50 MiB
  array['text/plain', 'text/markdown', 'text/html', 'application/pdf', 'application/json']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 路徑第一層必須是 owner_id，使用者只能讀寫自己的資料夾。
drop policy if exists "sources_storage_select_own" on storage.objects;
create policy "sources_storage_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "sources_storage_insert_own" on storage.objects;
create policy "sources_storage_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "sources_storage_update_own" on storage.objects;
create policy "sources_storage_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "sources_storage_delete_own" on storage.objects;
create policy "sources_storage_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 9. 佇列操作函式 ------------------------------------------------------------
-- 認領到期工作。只給 service_role 使用（背景 worker），以 SKIP LOCKED 避免重複處理。
create or replace function public.claim_processing_jobs(
  p_job_types public.job_type[],
  p_limit integer default 5,
  p_worker text default 'worker',
  p_owner uuid default null
)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select j.id
    from public.processing_jobs j
    where j.status in ('pending', 'retrying')
      and j.scheduled_at <= timezone('utc', now())
      and j.job_type = any(p_job_types)
      and (p_owner is null or j.owner_id = p_owner)
    order by j.scheduled_at
    limit p_limit
    for update skip locked
  )
  update public.processing_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      started_at = coalesce(j.started_at, timezone('utc', now())),
      locked_at = timezone('utc', now()),
      locked_by = p_worker,
      progress = 0
  from due
  where j.id = due.id
  returning j.*;
end;
$$;

revoke all on function public.claim_processing_jobs(public.job_type[], integer, text, uuid) from public;
grant execute on function public.claim_processing_jobs(public.job_type[], integer, text, uuid) to service_role;

-- 標記完成。
create or replace function public.complete_processing_job(
  p_job_id uuid,
  p_result jsonb default '{}'::jsonb,
  p_usage jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.processing_jobs
  set status = 'completed',
      progress = 100,
      result = p_result,
      model_usage = p_usage,
      last_error = null,
      finished_at = timezone('utc', now()),
      locked_at = null,
      locked_by = null
  where id = p_job_id;
end;
$$;

revoke all on function public.complete_processing_job(uuid, jsonb, jsonb) from public;
grant execute on function public.complete_processing_job(uuid, jsonb, jsonb) to service_role;

-- 標記失敗：未達重試上限改為 retrying 並套用指數退避，達上限則 failed。
create or replace function public.fail_processing_job(
  p_job_id uuid,
  p_error text
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_status public.job_status;
begin
  select * into v_job from public.processing_jobs where id = p_job_id;
  if not found then
    return null;
  end if;

  if v_job.attempts >= v_job.max_attempts then
    v_status := 'failed';
    update public.processing_jobs
    set status = v_status,
        last_error = p_error,
        finished_at = timezone('utc', now()),
        locked_at = null,
        locked_by = null
    where id = p_job_id;
  else
    v_status := 'retrying';
    update public.processing_jobs
    set status = v_status,
        last_error = p_error,
        -- 指數退避：30s、60s、120s…
        scheduled_at = timezone('utc', now()) + (interval '30 seconds' * power(2, v_job.attempts - 1)),
        locked_at = null,
        locked_by = null
    where id = p_job_id;
  end if;

  return v_status;
end;
$$;

revoke all on function public.fail_processing_job(uuid, text) from public;
grant execute on function public.fail_processing_job(uuid, text) to service_role;

-- 進度回報。
create or replace function public.update_job_progress(p_job_id uuid, p_progress integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.processing_jobs
  set progress = greatest(0, least(100, p_progress))
  where id = p_job_id;
end;
$$;

revoke all on function public.update_job_progress(uuid, integer) from public;
grant execute on function public.update_job_progress(uuid, integer) to service_role;

-- 10. 版本切換：寫入新版本時自動把舊版本的 is_current 取消 ---------------------
create or replace function public.sync_current_source_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_current then
    update public.source_versions
    set is_current = false
    where source_id = new.source_id
      and id <> new.id
      and is_current;

    update public.sources
    set current_version = new.version,
        content_hash = new.content_hash,
        title = coalesce(new.title, title),
        fetched_at = new.fetched_at
    where id = new.source_id;
  end if;
  return new;
end;
$$;

comment on function public.sync_current_source_version is
  '確保每個來源只有一個現行版本，並同步 sources 的 current_version 與 content_hash。';

drop trigger if exists source_versions_sync_current on public.source_versions;
create trigger source_versions_sync_current
  after insert or update of is_current on public.source_versions
  for each row
  when (new.is_current)
  execute function public.sync_current_source_version();
