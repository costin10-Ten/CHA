import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Dashboard 統計（工作單第 18 節）。
 *
 * 全部用 head + count 查詢，不把資料列拉回來；
 * 每一個數字都對應一個真實查詢，沒有寫死的數值。
 * 任何一項失敗只讓該項變成 null，不讓整個 Dashboard 掛掉
 * （例如某個 migration 還沒套用時）。
 */

export interface DashboardStats {
  sources: number | null;
  chunks: number | null;
  candidates: number | null;
  pendingReview: number | null;
  knowledgeFacts: number | null;
  highRisk: number | null;
  unsupportedSentences: number | null;
  blockedAnswers: number | null;
  drafts: number | null;
  activeEmbeddings: number | null;
}

export interface ApiUsage {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  failures: number;
  providers: string[];
}

async function countOf(
  build: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await build();
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();
  const COUNT = { count: "exact", head: true } as const;

  const [
    sources,
    chunks,
    candidates,
    pendingReview,
    knowledgeFacts,
    highRisk,
    unsupportedSentences,
    blockedAnswers,
    drafts,
    activeEmbeddings,
  ] = await Promise.all([
    countOf(() => supabase.from("sources").select("id", COUNT)),
    countOf(() => supabase.from("document_chunks").select("id", COUNT)),
    countOf(() => supabase.from("candidate_facts").select("id", COUNT)),
    countOf(() =>
      supabase.from("candidate_facts").select("id", COUNT).eq("status", "pending"),
    ),
    countOf(() =>
      supabase.from("knowledge_facts").select("id", COUNT).eq("status", "active"),
    ),
    countOf(() =>
      supabase
        .from("knowledge_facts")
        .select("id", COUNT)
        .eq("status", "active")
        .eq("risk_level", "high"),
    ),
    countOf(() =>
      supabase
        .from("answer_sentences")
        .select("id", COUNT)
        .eq("verdict", "unsupported"),
    ),
    countOf(() =>
      supabase.from("answer_sessions").select("id", COUNT).eq("status", "blocked"),
    ),
    countOf(() => supabase.from("communication_drafts").select("id", COUNT)),
    countOf(() =>
      supabase.from("embedding_records").select("id", COUNT).eq("is_active", true),
    ),
  ]);

  return {
    sources,
    chunks,
    candidates,
    pendingReview,
    knowledgeFacts,
    highRisk,
    unsupportedSentences,
    blockedAnswers,
    drafts,
    activeEmbeddings,
  };
}

/** API 用量概況：只統計本人的 model_runs。 */
export async function getApiUsage(limit = 500): Promise<ApiUsage> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("model_runs")
    .select("provider, input_tokens, output_tokens, status")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return { runs: 0, inputTokens: 0, outputTokens: 0, failures: 0, providers: [] };
  }

  return {
    runs: data.length,
    inputTokens: data.reduce((sum, run) => sum + (run.input_tokens ?? 0), 0),
    outputTokens: data.reduce((sum, run) => sum + (run.output_tokens ?? 0), 0),
    failures: data.filter((run) => run.status === "failed").length,
    providers: [...new Set(data.map((run) => run.provider))],
  };
}
