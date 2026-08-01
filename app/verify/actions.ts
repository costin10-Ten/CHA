"use server";

import { revalidatePath } from "next/cache";

import {
  buildPublishableAnswer,
  summarize,
  verifyAnswerSentences,
  type VerificationFact,
} from "@shared/verification.ts";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

/**
 * 回答逐句驗證（工作單第 14 節）。
 * 判定規則是確定性的，不再呼叫模型，結果可重現也可完整測試。
 */

export type VerifyResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string; publishable: boolean };

export async function verifyAnswerSession(
  sessionId: string,
): Promise<VerifyResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    const supabase = await createClient();

    const [{ data: sentences }, { data: evidence }] = await Promise.all([
      supabase
        .from("answer_sentences")
        .select("position, sentence")
        .eq("answer_session_id", sessionId)
        .order("position", { ascending: true }),
      supabase
        .from("answer_evidence")
        .select("knowledge_ref, knowledge_fact_id, statement, conditions")
        .eq("answer_session_id", sessionId),
    ]);

    if (!sentences || sentences.length === 0) {
      return { status: "error", message: "這筆問答沒有可驗證的句子" };
    }

    const facts: VerificationFact[] = (evidence ?? []).map((item) => ({
      knowledgeId: item.knowledge_ref,
      factId: item.knowledge_fact_id,
      statement: item.statement,
      conditions: (item.conditions ?? {}) as Record<string, string | null>,
    }));

    const results = verifyAnswerSentences(
      sentences.map((row) => row.sentence),
      facts,
    );
    const summary = summarize(results);
    const published = buildPublishableAnswer(results);

    const payload = results.map((result, index) => ({
      position: sentences[index].position,
      verdict: result.verdict,
      note: result.reasons.join("；"),
      similarity: Number(result.similarity.toFixed(3)),
      supporting_refs: result.supportingRefs,
      supporting_fact_ids: result.supportingFactIds,
    }));

    const { error } = await supabase.rpc("apply_answer_verification", {
      p_session_id: sessionId,
      p_sentences: payload as unknown as Json,
      p_published_answer: published,
    });

    if (error) throw new Error(`寫入驗證結果失敗：${error.message}`);

    revalidatePath("/ask");
    revalidatePath("/verify");
    revalidatePath(`/verify/${sessionId}`);

    return {
      status: "success",
      publishable: summary.publishable,
      message: summary.publishable
        ? `驗證完成：綠 ${summary.supported}、黃 ${summary.partial}，可產生發布稿。`
        : `驗證完成：綠 ${summary.supported}、黃 ${summary.partial}、紅 ${summary.unsupported}。有紅色句子，發布稿已被阻擋。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "驗證失敗",
    };
  }
}
