"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { FeedbackType } from "@/lib/supabase/types";

/**
 * 回報 AI 抽取問題（使用者需求）。
 *
 * 與 review_records 分開：那是審核歷程，這是模型品質回饋。
 * 回報時連同當時的 prompt_version_id 與 model_run_id 一起記錄，
 * 才能在 /settings/prompts 看出是哪一版提示詞常出問題。
 */

export type FeedbackResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

const FEEDBACK_TYPES: FeedbackType[] = [
  "beyond_source",
  "condition_lost",
  "number_error",
  "certainty_escalated",
  "wrong_subject",
  "bad_sentence_split",
  "quote_mismatch",
  "other",
];

export async function reportExtractionIssue(
  candidateFactId: string,
  feedbackType: string,
  description?: string,
): Promise<FeedbackResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    if (!(FEEDBACK_TYPES as string[]).includes(feedbackType)) {
      return { status: "error", message: "不支援的問題類型" };
    }

    const supabase = await createClient();
    const { data: fact, error: loadError } = await supabase
      .from("candidate_facts")
      .select(
        "id, source_id, source_version_id, source_paragraph_id, statement, source_quote, prompt_version_id, model_run_id",
      )
      .eq("id", candidateFactId)
      .single();

    if (loadError || !fact) throw new Error("找不到候選原子命題");

    // 連同原文段落一起存下來，日後候選原子命題被改掉仍看得到問題現場。
    const { data: chunk } = await supabase
      .from("document_chunks")
      .select("text")
      .eq("source_version_id", fact.source_version_id)
      .eq("paragraph_id", fact.source_paragraph_id)
      .maybeSingle();

    const { error } = await supabase.from("extraction_feedback").insert({
      owner_id: user.id,
      candidate_fact_id: fact.id,
      source_id: fact.source_id,
      prompt_version_id: fact.prompt_version_id,
      model_run_id: fact.model_run_id,
      feedback_type: feedbackType as FeedbackType,
      description: description?.trim() || null,
      statement_snapshot: fact.statement,
      quote_snapshot: fact.source_quote,
      paragraph_snapshot: chunk?.text ?? null,
    });

    if (error) throw new Error(`寫入回報失敗：${error.message}`);

    revalidatePath("/review");
    revalidatePath(`/review/${candidateFactId}`);
    revalidatePath("/settings/prompts");

    return {
      status: "success",
      message: "已回報。這筆回饋會出現在提示詞品質統計中。",
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "回報失敗",
    };
  }
}

export async function resolveFeedback(
  feedbackId: string,
  resolved: boolean,
): Promise<FeedbackResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("extraction_feedback")
      .update({ resolved })
      .eq("id", feedbackId);

    if (error) throw new Error(error.message);

    revalidatePath("/settings/prompts");
    return {
      status: "success",
      message: resolved ? "已標記為已處理。" : "已改回未處理。",
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "更新失敗",
    };
  }
}
