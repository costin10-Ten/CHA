import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ExtractionFeedbackRow,
  PromptFeedbackStat,
  PromptVersionRow,
} from "@/lib/supabase/types";

/** 提示詞版本與其回報統計。統計失敗時不擋住頁面。 */
export async function listPromptVersions(): Promise<PromptVersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .order("name", { ascending: true })
    .order("version", { ascending: false });

  if (error) throw new Error(`讀取提示詞版本失敗：${error.message}`);
  return data ?? [];
}

export async function getPromptFeedbackStats(): Promise<PromptFeedbackStat[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prompt_feedback_stats", {});
  if (error) return [];
  return data ?? [];
}

export async function listExtractionFeedback(
  limit = 50,
): Promise<ExtractionFeedbackRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("extraction_feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取回報紀錄失敗：${error.message}`);
  return data ?? [];
}

export interface ModelUsage {
  provider: string;
  model: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  failures: number;
}

/** API 用量概況（工作單第 18 節 Dashboard 與 /settings/models 共用）。 */
export async function getModelUsage(limit = 1000): Promise<ModelUsage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("model_runs")
    .select("provider, model, input_tokens, output_tokens, status")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];

  const grouped = new Map<string, ModelUsage>();
  for (const run of data ?? []) {
    const key = `${run.provider}／${run.model}`;
    const entry = grouped.get(key) ?? {
      provider: run.provider,
      model: run.model,
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      failures: 0,
    };

    entry.runs += 1;
    entry.inputTokens += run.input_tokens ?? 0;
    entry.outputTokens += run.output_tokens ?? 0;
    if (run.status === "failed") entry.failures += 1;
    grouped.set(key, entry);
  }

  return [...grouped.values()].sort((a, b) => b.runs - a.runs);
}
