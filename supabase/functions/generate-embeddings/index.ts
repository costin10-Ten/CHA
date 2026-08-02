// Supabase Edge Function：向量產生 worker
//
// 只為需要的原子命題產生向量，不重建全部索引：
//   - payload.knowledge_fact_id 指定單筆（核定或修改原子命題時排入）
//   - 沒有指定時，補齊所有「現行但沒有現行向量」的原子命題
//
// 寫入新向量前會先把該筆原子命題的舊向量停用，
// 因此搜尋永遠只會命中現行版本。

import { createClient } from "jsr:@supabase/supabase-js@2";

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { contentHash } from "../_shared/hash.ts";
import { createEmbeddingProvider } from "../_shared/llm/embeddings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const EMBEDDING_CONFIG = {
  provider:
    Deno.env.get("EMBEDDING_PROVIDER") ?? Deno.env.get("LLM_PROVIDER") ?? "mock",
  model: Deno.env.get("EMBEDDING_MODEL") ?? "",
  apiKey: Deno.env.get("OPENAI_API_KEY") ?? undefined,
  baseUrl: Deno.env.get("LLM_BASE_URL") ?? undefined,
};

const BATCH_JOBS = 3;
const FACTS_PER_CALL = 32;
const MAX_FACTS_PER_JOB = 200;

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

interface FactRow {
  id: string;
  statement: string;
  version: number;
  conditions: Record<string, string | null> | null;
}

/** 向量的輸入文字：原子命題敘述加上條件，讓搜尋能區分不同族群或劑量的版本。 */
function buildEmbeddingInput(fact: FactRow): string {
  const conditions = Object.entries(fact.conditions ?? {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");

  return conditions ? `${fact.statement}（${conditions}）` : fact.statement;
}

async function processEmbeddingJob(job: {
  id: string;
  owner_id: string;
  source_id: string | null;
  payload?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const targetId =
    typeof job.payload?.knowledge_fact_id === "string"
      ? job.payload.knowledge_fact_id
      : null;

  let query = admin
    .from("knowledge_facts")
    .select("id, statement, version, conditions")
    .eq("owner_id", job.owner_id)
    .eq("status", "active")
    .limit(MAX_FACTS_PER_JOB);

  if (targetId) query = query.eq("id", targetId);

  const { data: facts, error } = await query;
  if (error) throw new Error(`讀取正式原子命題失敗：${error.message}`);

  let pending = (facts ?? []) as FactRow[];

  // 未指定單筆時，只補齊沒有現行向量的原子命題。
  if (!targetId && pending.length > 0) {
    const { data: existing } = await admin
      .from("embedding_records")
      .select("knowledge_fact_id, fact_version")
      .eq("owner_id", job.owner_id)
      .eq("is_active", true);

    const covered = new Set(
      (existing ?? []).map(
        (record) => `${record.knowledge_fact_id}:${record.fact_version}`,
      ),
    );
    pending = pending.filter((fact) => !covered.has(`${fact.id}:${fact.version}`));
  }

  if (pending.length === 0) {
    return { embedded: 0, reason: "沒有需要產生向量的原子命題" };
  }

  const provider = createEmbeddingProvider(EMBEDDING_CONFIG);
  let embedded = 0;

  for (let index = 0; index < pending.length; index += FACTS_PER_CALL) {
    const slice = pending.slice(index, index + FACTS_PER_CALL);
    const inputs = slice.map(buildEmbeddingInput);

    const started = Date.now();
    const vectors = await provider.embed(inputs);
    const latency = Date.now() - started;

    for (let position = 0; position < slice.length; position += 1) {
      const fact = slice[position];

      // 先停用這筆原子命題既有的向量，再寫入新的，避免同時有兩個現行向量。
      await admin
        .from("embedding_records")
        .update({ is_active: false })
        .eq("knowledge_fact_id", fact.id)
        .eq("is_active", true);

      const { error: insertError } = await admin.from("embedding_records").insert({
        owner_id: job.owner_id,
        knowledge_fact_id: fact.id,
        fact_version: fact.version,
        embedding: vectors[position],
        embedding_model: provider.model,
        embedding_version: "v1",
        content_hash: await contentHash(inputs[position]),
        is_active: true,
      });

      if (insertError) throw new Error(`寫入向量失敗：${insertError.message}`);
      embedded += 1;
    }

    await admin.from("model_runs").insert({
      owner_id: job.owner_id,
      job_id: job.id,
      source_id: job.source_id,
      purpose: "generate_embeddings",
      provider: provider.name,
      model: provider.model,
      input_tokens: inputs.reduce((total, text) => total + text.length, 0),
      output_tokens: 0,
      latency_ms: latency,
      status: "completed",
    });

    await admin.rpc("update_job_progress", {
      p_job_id: job.id,
      p_progress: Math.min(
        95,
        Math.round(((index + slice.length) / pending.length) * 100),
      ),
    });
  }

  return {
    embedded,
    provider: provider.name,
    model: provider.model,
    dimensions: provider.dimensions,
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return jsonResponse({ error: "只接受 POST" }, 405);

  const caller = await resolveCaller(req);
  if (caller.mode === "denied") return jsonResponse({ error: "未授權" }, 401);

  await admin.rpc("requeue_stale_jobs", { p_timeout_minutes: 5 });

  const { data: jobs, error } = await admin.rpc("claim_processing_jobs", {
    p_job_types: ["generate_embeddings"],
    p_limit: BATCH_JOBS,
    p_worker: `edge-embed:${caller.mode}`,
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
      const result = await processEmbeddingJob(job);
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
