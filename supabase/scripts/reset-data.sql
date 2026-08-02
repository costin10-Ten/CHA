-- =============================================================================
-- 清空知識資料（保留帳號、提示詞版本與資料表結構）
--
-- 用法：Supabase Dashboard → SQL Editor → 貼上 → 把下面的 email 換成你的登入
-- 信箱 → Run。
--
-- 會刪除：來源文件、文件版本、段落、候選原子命題、審核紀錄、正式原子命題、原子命題版本、
--         實體、關聯、向量索引、問答紀錄、素材草稿、抽取回報、工作佇列、模型呼叫紀錄
-- 不會刪除：auth.users（你的帳號）、profiles、prompt_versions（提示詞版本）
--
-- 注意：這個動作不可復原。要保留的資料請先到 /export 匯出備份。
-- =============================================================================

do $$
declare
  -- ⬇︎ 換成你的登入信箱
  v_email text := 'you@example.com';
  v_owner uuid;
  v_sources bigint;
  v_candidates bigint;
  v_facts bigint;
begin
  select id into v_owner from auth.users where email = v_email;

  if v_owner is null then
    raise exception '找不到這個信箱的帳號：%（請確認 SQL Editor 裡的 email 有改對）', v_email;
  end if;

  select count(*) into v_sources from public.sources where owner_id = v_owner;
  select count(*) into v_candidates from public.candidate_facts where owner_id = v_owner;
  select count(*) into v_facts from public.knowledge_facts where owner_id = v_owner;

  -- 沒有從 sources 串聯過來的，要自己刪。
  delete from public.communication_drafts where owner_id = v_owner;
  delete from public.answer_sessions where owner_id = v_owner;   -- 連帶 answer_evidence、answer_sentences
  delete from public.entities where owner_id = v_owner;          -- 連帶 relations
  delete from public.extraction_feedback where owner_id = v_owner;

  -- 刪 sources 會串聯刪掉 source_versions、document_chunks、candidate_facts、
  -- review_records、knowledge_facts、fact_versions、embedding_records。
  delete from public.sources where owner_id = v_owner;

  -- 保險：source_id 可為 null 的表，以及理論上已被串聯刪除的表。
  delete from public.knowledge_facts where owner_id = v_owner;
  delete from public.candidate_facts where owner_id = v_owner;
  delete from public.processing_jobs where owner_id = v_owner;
  delete from public.model_runs where owner_id = v_owner;

  raise notice '已清空 %：來源 % 筆、候選原子命題 % 筆、正式原子命題 % 筆。',
    v_email, v_sources, v_candidates, v_facts;
end
$$;

-- =============================================================================
-- 上傳的檔案本體存在 Storage，不會隨資料表一起刪除。
-- 確定要一併清掉時，取消下面這段的註解再執行一次。
-- =============================================================================

-- delete from storage.objects
-- where bucket_id = 'sources'
--   and (storage.foldername(name))[1] = (
--     select id::text from auth.users where email = 'you@example.com'
--   );

-- =============================================================================
-- 確認結果：全部應該是 0。
-- =============================================================================

-- select
--   (select count(*) from public.sources)         as sources,
--   (select count(*) from public.candidate_facts) as candidates,
--   (select count(*) from public.knowledge_facts) as facts,
--   (select count(*) from public.entities)        as entities,
--   (select count(*) from public.embedding_records) as embeddings;
