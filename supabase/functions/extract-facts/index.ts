// Supabase Edge Function：候選原子命題抽取 worker
//
// 流程：
//   claim_processing_jobs('extract_facts')
//   → 讀取來源現行版本的段落
//   → 分批送進模型（預設 Mock Provider，可切換 OpenAI／Anthropic）
//   → 解析 JSON 輸出並執行自動品質檢查
//   → 無來源片段或片段不在原文者直接丟棄，其餘寫入 candidate_facts 並帶品質標記
//   → 記錄 model_runs 用量與 prompt_versions 版本
//
// 品質檢查與提示詞邏輯與單元測試共用 ../_shared 內的程式碼。

import { createClient } from "jsr:@supabase/supabase-js@2";

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_PROMPT_NAME,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionMessages,
  parseFactsResponse,
  promptChecksum,
  type ExtractionParagraph,
} from "../_shared/extraction.ts";
import { sha256Hex } from "../_shared/hash.ts";
import { createProvider } from "../_shared/llm/factory.ts";
import { checkFactQuality, normalizeForCompare } from "../_shared/quality.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const PROVIDER_CONFIG = {
  provider: Deno.env.get("LLM_PROVIDER") ?? "mock",
  model: Deno.env.get("LLM_MODEL") ?? "",
  apiKey:
    (Deno.env.get("LLM_PROVIDER") ?? "mock") === "anthropic"
      ? Deno.env.get("ANTHROPIC_API_KEY")
      : Deno.env.get("OPENAI_API_KEY"),
  baseUrl: Deno.env.get("LLM_BASE_URL") ?? undefined,
};

const BATCH_JOBS = 2;
const PARAGRAPHS_PER_CALL = 6;
const MIN_PARAGRAPH_LENGTH = 12;
const EXTRACTABLE_BLOCK_TYPES = ["paragraph", "list_item", "quote"];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resolveCaller(
  req: Request,
): Promise<
  { mode: "cron" } | { mode: "user"; userId: string } | { mode: "denied" }
> {
  const cronHeader = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronHeader && cronHeader === CRON_SECRET)
    return { mode: "cron" };

  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return { mode: "denied" };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { mode: "denied" };
  return { mode: "user", userId: data.user.id };
}

interface ChunkRow {
  id: string;
  paragraph_id: string;
  text: string;
  block_type: string;
  heading_path: string[];
}

async function processExtractionJob(job: {
  id: string;
  owner_id: string;
  source_id: string | null;
  payload?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!job.source_id) throw new Error("工作缺少 source_id");

  const { data: source, error: sourceError } = await admin
    .from("sources")
    .select("id, title, owner_id, origin_url")
    .eq("id", job.source_id)
    .eq("owner_id", job.owner_id)
    .single<{
      id: string;
      title: string;
      owner_id: string;
      origin_url: string | null;
    }>();

  if (sourceError || !source) {
    throw new Error(`找不到來源文件：${sourceError?.message ?? job.source_id}`);
  }

  const { data: version, error: versionError } = await admin
    .from("source_versions")
    .select("id, version")
    .eq("source_id", source.id)
    .eq("is_current", true)
    .maybeSingle<{ id: string; version: number }>();

  if (versionError || !version) {
    throw new Error("來源尚未解析完成，沒有現行版本可抽取");
  }

  const { data: chunks, error: chunkError } = await admin
    .from("document_chunks")
    .select("id, paragraph_id, text, block_type, heading_path")
    .eq("source_version_id", version.id)
    .order("position", { ascending: true });

  if (chunkError) throw new Error(`讀取段落失敗：${chunkError.message}`);

  // 審核介面的「重新抽取本段」只會帶入指定段落。
  const onlyParagraphs = Array.isArray(job.payload?.paragraph_ids)
    ? new Set((job.payload.paragraph_ids as unknown[]).map(String))
    : null;

  const usable = (chunks ?? []).filter(
    (chunk: ChunkRow) =>
      EXTRACTABLE_BLOCK_TYPES.includes(chunk.block_type) &&
      chunk.text.trim().length >= MIN_PARAGRAPH_LENGTH &&
      (!onlyParagraphs || onlyParagraphs.has(chunk.paragraph_id)),
  ) as ChunkRow[];

  if (usable.length === 0) {
    return { inserted: 0, rejected: 0, reason: "沒有可抽取的段落" };
  }

  const checksum = await promptChecksum(EXTRACTION_SYSTEM_PROMPT);
  const { data: promptVersionId } = await admin.rpc("upsert_prompt_version", {
    p_owner: job.owner_id,
    p_name: EXTRACTION_PROMPT_NAME,
    p_purpose: "候選原子命題抽取",
    p_template: EXTRACTION_SYSTEM_PROMPT,
    p_checksum: checksum,
  });

  const provider = createProvider(PROVIDER_CONFIG);
  const batchId = crypto.randomUUID();
  const chunkByParagraph = new Map(
    usable.map((chunk) => [chunk.paragraph_id, chunk]),
  );

  let inserted = 0;
  let rejected = 0;
  let flagged = 0;
  const discarded: { reason: string }[] = [];
  const acceptedStatements: { statement: string; subject: string | null }[] = [];

  for (let index = 0; index < usable.length; index += PARAGRAPHS_PER_CALL) {
    const slice = usable.slice(index, index + PARAGRAPHS_PER_CALL);
    const paragraphs: ExtractionParagraph[] = slice.map((chunk) => ({
      paragraphId: chunk.paragraph_id,
      text: chunk.text,
      headingPath: chunk.heading_path,
    }));

    const messages = buildExtractionMessages(source.title, paragraphs);

    let response;
    try {
      response = await provider.complete({
        messages,
        temperature: 0,
        jsonSchema: EXTRACTION_JSON_SCHEMA,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await admin.from("model_runs").insert({
        owner_id: job.owner_id,
        job_id: job.id,
        source_id: source.id,
        prompt_version_id: promptVersionId ?? null,
        purpose: "extract_facts",
        provider: provider.name,
        model: provider.model,
        status: "failed",
        error: message,
      });
      throw new Error(`模型呼叫失敗：${message}`);
    }

    const { data: modelRun } = await admin
      .from("model_runs")
      .insert({
        owner_id: job.owner_id,
        job_id: job.id,
        source_id: source.id,
        prompt_version_id: promptVersionId ?? null,
        purpose: "extract_facts",
        provider: response.provider,
        model: response.model,
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
        latency_ms: response.latencyMs,
        status: "completed",
      })
      .select("id")
      .single<{ id: string }>();

    const parsed = parseFactsResponse(response.text);
    discarded.push(...parsed.discarded.map((item) => ({ reason: item.reason })));
    rejected += parsed.discarded.length;

    const rows: Record<string, unknown>[] = [];

    for (const fact of parsed.facts) {
      const chunk = chunkByParagraph.get(fact.source_paragraph_id);
      if (!chunk) {
        rejected += 1;
        discarded.push({
          reason: `段落編號 ${fact.source_paragraph_id} 不在本批次`,
        });
        continue;
      }

      const quality = checkFactQuality(fact, {
        paragraphText: chunk.text,
        previousStatements: acceptedStatements,
        // 「醫學健康建議」須為政府機關來源，靠這個網址判斷。
        sourceUrl: source.origin_url,
      });

      // 無來源片段或片段不在原文者不得進入核定流程。
      if (quality.fatal) {
        rejected += 1;
        discarded.push({ reason: quality.flags.join(",") });
        continue;
      }

      if (quality.flags.length > 0) flagged += 1;
      acceptedStatements.push({ statement: fact.statement, subject: fact.subject });

      rows.push({
        owner_id: job.owner_id,
        source_id: source.id,
        source_version_id: version.id,
        document_chunk_id: chunk.id,
        statement: fact.statement,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        proposition_types: fact.proposition_types,
        conditions: fact.conditions,
        source_quote: fact.source_quote,
        source_paragraph_id: fact.source_paragraph_id,
        risk_level: fact.risk_level,
        confidence: fact.confidence,
        status: "pending",
        quality_flags: quality.flags,
        quality_score: quality.score,
        statement_hash: await sha256Hex(normalizeForCompare(fact.statement)),
        prompt_version_id: promptVersionId ?? null,
        model_run_id: modelRun?.id ?? null,
        extraction_batch: batchId,
      });
    }

    if (rows.length > 0) {
      const { data: insertedRows, error } = await admin
        .from("candidate_facts")
        .upsert(rows, {
          onConflict: "source_version_id,statement_hash",
          ignoreDuplicates: true,
        })
        .select("id");

      if (error) throw new Error(`寫入候選原子命題失敗：${error.message}`);
      inserted += insertedRows?.length ?? 0;
    }

    const progress = Math.min(
      95,
      Math.round(((index + slice.length) / usable.length) * 100),
    );
    await admin.rpc("update_job_progress", {
      p_job_id: job.id,
      p_progress: progress,
    });
  }

  return {
    inserted,
    rejected,
    flagged,
    paragraphs: usable.length,
    provider: provider.name,
    model: provider.model,
    batch_id: batchId,
    discarded: discarded.slice(0, 20),
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return jsonResponse({ error: "只接受 POST" }, 405);

  const caller = await resolveCaller(req);
  if (caller.mode === "denied") return jsonResponse({ error: "未授權" }, 401);

  // 先把卡在 processing 的逾時工作放回佇列，避免函式中斷後永遠卡住。
  await admin.rpc("requeue_stale_jobs", { p_timeout_minutes: 5 });

  const { data: jobs, error } = await admin.rpc("claim_processing_jobs", {
    p_job_types: ["extract_facts"],
    p_limit: BATCH_JOBS,
    p_worker: `edge-extract:${caller.mode}`,
    p_owner: caller.mode === "user" ? caller.userId : null,
  });

  if (error) return jsonResponse({ error: `認領工作失敗：${error.message}` }, 500);

  const claimed = (jobs ?? []) as {
    id: string;
    owner_id: string;
    source_id: string | null;
    payload?: Record<string, unknown>;
  }[];

  const results: Record<string, unknown>[] = [];

  for (const job of claimed) {
    try {
      const result = await processExtractionJob(job);
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
      results.push({ job_id: job.id, status: status ?? "failed", error: message });
    }
  }

  return jsonResponse({ claimed: claimed.length, results });
});
