// Supabase Edge Function：文件解析 worker
//
// 觸發方式：
//   1. 前端匯入來源後以使用者 JWT 呼叫 → 只處理該使用者的到期工作
//   2. Supabase Cron 以 x-cron-secret 呼叫 → 處理所有到期工作（含重試）
//
// 工作流程：
//   claim_processing_jobs（FOR UPDATE SKIP LOCKED）
//   → 取得原始內容（Storage 或抓取網址）
//   → 解析成段落
//   → 內容雜湊相同則不建立新版本
//   → 建立新版本與 document_chunks，舊版本自動失去 is_current
//   → complete_processing_job / fail_processing_job（含指數退避重試）
//
// 解析邏輯與單元測試共用 ../_shared 內的程式碼，不重複實作。

import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1";

import {
  detectParseKind,
  parseDocument,
  type ParseKind,
} from "../_shared/parse.ts";
import { diffVersions, type StoredBlock } from "../_shared/diff.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BUCKET = "sources";
const BATCH_SIZE = 3;
const CHUNK_INSERT_SIZE = 200;
const MAX_FETCH_BYTES = 5_000_000;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 解析呼叫者身分：cron secret 或使用者 JWT。 */
async function resolveCaller(
  req: Request,
): Promise<
  { mode: "cron" } | { mode: "user"; userId: string } | { mode: "denied" }
> {
  const cronHeader = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronHeader && cronHeader === CRON_SECRET) {
    return { mode: "cron" };
  }

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { mode: "denied" };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { mode: "denied" };
  return { mode: "user", userId: data.user.id };
}

async function readStorageText(
  path: string,
  kind: ParseKind,
): Promise<{ raw: string; rawHtml: string | null }> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(
      `無法讀取 Storage 檔案 ${path}：${error?.message ?? "not found"}`,
    );
  }

  if (kind === "pdf") {
    const buffer = new Uint8Array(await data.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n\n") : text;
    if (!merged.trim()) {
      throw new Error(
        "這份 PDF 沒有可抽取的文字層（可能是掃描檔），請改用文字型 PDF",
      );
    }
    return { raw: merged, rawHtml: null };
  }

  const raw = await data.text();
  return { raw, rawHtml: kind === "html" ? raw : null };
}

async function fetchUrl(url: string): Promise<{ raw: string; rawHtml: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; PersonalKnowledgeStudio/1.0; +https://github.com/costin10-Ten/CHA)",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`抓取網址失敗：HTTP ${response.status}`);
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_FETCH_BYTES) {
    throw new Error(`網頁過大（${length} bytes），超過 ${MAX_FETCH_BYTES} 限制`);
  }

  const html = await response.text();
  if (html.length > MAX_FETCH_BYTES) {
    throw new Error("網頁內容超過大小限制");
  }
  return { raw: html, rawHtml: html };
}

interface SourceRow {
  id: string;
  owner_id: string;
  title: string;
  source_type: "text" | "file" | "url";
  origin_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  current_version: number;
  content_hash: string | null;
}

async function processParseJob(job: {
  id: string;
  owner_id: string;
  source_id: string | null;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!job.source_id) throw new Error("工作缺少 source_id");

  const { data: source, error: sourceError } = await admin
    .from("sources")
    .select(
      "id, owner_id, title, source_type, origin_url, storage_path, mime_type, current_version, content_hash",
    )
    .eq("id", job.source_id)
    .eq("owner_id", job.owner_id)
    .single<SourceRow>();

  if (sourceError || !source) {
    throw new Error(`找不到來源文件：${sourceError?.message ?? job.source_id}`);
  }

  await admin
    .from("sources")
    .update({ status: "processing", last_error: null })
    .eq("id", source.id);
  await admin.rpc("update_job_progress", { p_job_id: job.id, p_progress: 10 });

  let kind: ParseKind;
  let raw: string;
  let rawHtml: string | null = null;
  let storagePath = source.storage_path;

  if (source.source_type === "url") {
    if (!source.origin_url) throw new Error("來源缺少網址");
    kind = "html";
    const fetched = await fetchUrl(source.origin_url);
    raw = fetched.raw;
    rawHtml = fetched.rawHtml;

    storagePath = `${source.owner_id}/${source.id}/raw.html`;
    await admin.storage
      .from(BUCKET)
      .upload(storagePath, new Blob([rawHtml], { type: "text/html" }), {
        upsert: true,
        contentType: "text/html",
      });
  } else {
    if (!source.storage_path) throw new Error("來源缺少 Storage 路徑");
    kind = detectParseKind(source.storage_path, source.mime_type);
    const loaded = await readStorageText(source.storage_path, kind);
    raw = loaded.raw;
    rawHtml = loaded.rawHtml;
  }

  await admin.rpc("update_job_progress", { p_job_id: job.id, p_progress: 40 });

  const parsed = await parseDocument({
    kind,
    raw,
    title: typeof job.payload.title === "string" ? job.payload.title : undefined,
    fallbackTitle: source.title,
  });

  if (parsed.blocks.length === 0) {
    throw new Error("解析後沒有任何段落，請確認內容是否為空或格式不受支援");
  }

  // 內容未變動就不建立新版本（工作單第 16 節）。
  if (source.content_hash && source.content_hash === parsed.contentHash) {
    await admin
      .from("sources")
      .update({ status: "ready", fetched_at: new Date().toISOString() })
      .eq("id", source.id);
    return {
      unchanged: true,
      version: source.current_version,
      chunk_count: parsed.blocks.length,
    };
  }

  // 舊版段落供增量比對。
  const { data: previousChunks } = await admin
    .from("document_chunks")
    .select("paragraph_id, content_hash, source_version_id")
    .eq("source_id", source.id)
    .eq("owner_id", source.owner_id)
    .order("position", { ascending: true });

  const { data: currentVersion } = await admin
    .from("source_versions")
    .select("id")
    .eq("source_id", source.id)
    .eq("is_current", true)
    .maybeSingle<{ id: string }>();

  const previousBlocks: StoredBlock[] = (previousChunks ?? [])
    .filter(
      (chunk) => !currentVersion || chunk.source_version_id === currentVersion.id,
    )
    .map((chunk) => ({
      paragraphId: chunk.paragraph_id as string,
      contentHash: chunk.content_hash as string,
    }));

  const diff = diffVersions(previousBlocks, parsed.blocks);
  const nextVersion = source.current_version + 1;

  const parsedPath = `${source.owner_id}/${source.id}/parsed-v${nextVersion}.json`;
  await admin.storage
    .from(BUCKET)
    .upload(
      parsedPath,
      new Blob([JSON.stringify(parsed, null, 2)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" },
    );

  await admin.rpc("update_job_progress", { p_job_id: job.id, p_progress: 65 });

  const { data: version, error: versionError } = await admin
    .from("source_versions")
    .insert({
      owner_id: source.owner_id,
      source_id: source.id,
      version: nextVersion,
      title: parsed.title,
      raw_text: parsed.text.slice(0, 1_000_000),
      raw_html: rawHtml ? rawHtml.slice(0, 1_000_000) : null,
      storage_path: parsedPath,
      content_hash: parsed.contentHash,
      parser_version: parsed.parserVersion,
      char_count: parsed.charCount,
      chunk_count: parsed.blocks.length,
      is_current: true,
      fetched_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (versionError || !version) {
    throw new Error(`建立版本失敗：${versionError?.message}`);
  }

  const rows = parsed.blocks.map((block) => ({
    owner_id: source.owner_id,
    source_id: source.id,
    source_version_id: version.id,
    paragraph_id: block.paragraphId,
    position: block.position,
    block_type: block.blockType,
    heading_path: block.headingPath,
    text: block.text,
    char_start: block.charStart,
    char_end: block.charEnd,
    content_hash: block.contentHash,
  }));

  for (let index = 0; index < rows.length; index += CHUNK_INSERT_SIZE) {
    const slice = rows.slice(index, index + CHUNK_INSERT_SIZE);
    const { error } = await admin.from("document_chunks").insert(slice);
    if (error) throw new Error(`寫入段落失敗：${error.message}`);

    const progress = 65 + Math.round(((index + slice.length) / rows.length) * 30);
    await admin.rpc("update_job_progress", {
      p_job_id: job.id,
      p_progress: progress,
    });
  }

  await admin
    .from("sources")
    .update({
      status: "ready",
      title: parsed.title,
      storage_path: storagePath,
      last_error: null,
      fetched_at: new Date().toISOString(),
    })
    .eq("id", source.id);

  // 解析完成後接著排入候選事實抽取（Phase 3）。
  const { error: chainError } = await admin.from("processing_jobs").insert({
    owner_id: source.owner_id,
    job_type: "extract_facts",
    source_id: source.id,
    payload: { source_version_id: version.id },
  });
  if (chainError) {
    throw new Error(`建立事實抽取工作失敗：${chainError.message}`);
  }

  return {
    unchanged: false,
    version: nextVersion,
    chunk_count: parsed.blocks.length,
    char_count: parsed.charCount,
    parser_version: parsed.parserVersion,
    diff,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "只接受 POST" }, 405);
  }

  const caller = await resolveCaller(req);
  if (caller.mode === "denied") {
    return json({ error: "未授權" }, 401);
  }

  const { data: jobs, error } = await admin.rpc("claim_processing_jobs", {
    p_job_types: ["parse_document"],
    p_limit: BATCH_SIZE,
    p_worker: `edge:${caller.mode}`,
    p_owner: caller.mode === "user" ? caller.userId : null,
  });

  if (error) {
    return json({ error: `認領工作失敗：${error.message}` }, 500);
  }

  const claimed = (jobs ?? []) as {
    id: string;
    owner_id: string;
    source_id: string | null;
    payload: Record<string, unknown>;
  }[];

  const results: Record<string, unknown>[] = [];

  for (const job of claimed) {
    try {
      const result = await processParseJob(job);
      await admin.rpc("complete_processing_job", {
        p_job_id: job.id,
        p_result: result,
        p_usage: {},
      });
      results.push({ job_id: job.id, status: "completed", ...result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const { data: status } = await admin.rpc("fail_processing_job", {
        p_job_id: job.id,
        p_error: message,
      });
      if (job.source_id) {
        await admin
          .from("sources")
          .update({
            status: status === "failed" ? "failed" : "pending",
            last_error: message,
          })
          .eq("id", job.source_id);
      }
      results.push({ job_id: job.id, status: status ?? "failed", error: message });
    }
  }

  return json({ claimed: claimed.length, results });
});
