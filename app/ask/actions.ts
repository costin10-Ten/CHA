"use server";

import { revalidatePath } from "next/cache";

import {
  ANSWER_PROMPT_NAME,
  ANSWER_SYSTEM_PROMPT,
  answerPromptChecksum,
  buildAnswerMessages,
  buildEvidencePack,
  declaresInsufficient,
  findUnknownCitations,
  formatKnowledgeRef,
  splitAnswerSentences,
  type EvidenceFact,
} from "@shared/answering.ts";
import { createProvider } from "@shared/llm/factory.ts";

import { searchKnowledgeFacts } from "@/lib/retrieval/search";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type {
  AnswerEvidenceRow,
  Json,
  KnowledgeType,
  RiskLevel,
} from "@/lib/supabase/types";

/**
 * AI 問答（工作單第 13 節）。
 *
 * 流程：混合搜尋取出核定事實 → 組證據包 → 送模型 → 保存 session、證據與拆句。
 * 模型只看得到證據包，看不到任何未核定內容。
 */

const EVIDENCE_LIMIT = 8;

export type AskResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; sessionId: string; message: string };

export interface AskOptions {
  sourceId?: string;
  knowledgeType?: KnowledgeType;
  riskLevel?: RiskLevel;
}

function providerConfig() {
  const provider = process.env.LLM_PROVIDER ?? "mock";
  return {
    provider,
    model: process.env.LLM_MODEL || undefined,
    apiKey:
      provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || undefined,
  };
}

export async function askQuestion(
  question: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const trimmed = question.trim();
  if (trimmed.length < 4) {
    return { status: "error", message: "問題太短，請描述得完整一點" };
  }

  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    const supabase = await createClient();

    // 1. 混合搜尋取出候選證據（只會取到現行的核定事實）
    const results = await searchKnowledgeFacts({
      query: trimmed,
      sourceId: options.sourceId,
      knowledgeType: options.knowledgeType,
      riskLevel: options.riskLevel,
      limit: EVIDENCE_LIMIT,
    });

    // 2. 補上來源資訊，組成證據包
    const sourceIds = [...new Set(results.map((row) => row.source_id))];
    const { data: sources } = sourceIds.length
      ? await supabase
          .from("sources")
          .select("id, title, origin_url")
          .in("id", sourceIds)
      : { data: [] };

    const sourceById = new Map(
      (sources ?? []).map((source) => [source.id, source]),
    );

    const evidence: EvidenceFact[] = results.map((row, index) => {
      const source = sourceById.get(row.source_id);
      return {
        knowledgeId: formatKnowledgeRef(index),
        factId: row.id,
        statement: row.statement,
        conditions: (row.conditions ?? {}) as Record<string, string | null>,
        sourceTitle: source?.title ?? null,
        sourceUrl: source?.origin_url ?? null,
        sourceLocator: `第 ${row.source_paragraph_id} 段`,
        version: row.version,
      };
    });

    const pack = buildEvidencePack(trimmed, evidence);

    // 3. 建立 session（即使沒有證據也留紀錄）
    const { data: session, error: sessionError } = await supabase
      .from("answer_sessions")
      .insert({
        owner_id: user.id,
        question: trimmed,
        status: "draft",
        evidence_count: evidence.length,
        filters: options as unknown as Json,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      throw new Error(`建立問答紀錄失敗：${sessionError?.message}`);
    }

    if (evidence.length > 0) {
      const { error: evidenceError } = await supabase
        .from("answer_evidence")
        .insert(
          evidence.map((fact, index) => ({
            owner_id: user.id,
            answer_session_id: session.id,
            knowledge_fact_id: fact.factId,
            knowledge_ref: fact.knowledgeId,
            rank: index + 1,
            keyword_rank: results[index].keyword_rank,
            vector_similarity: results[index].vector_similarity,
            combined_score: results[index].combined_score,
            statement: fact.statement,
            conditions:
              fact.conditions as unknown as AnswerEvidenceRow["conditions"],
            source_title: fact.sourceTitle,
            source_url: fact.sourceUrl,
            source_locator: fact.sourceLocator,
            fact_version: fact.version,
          })),
        );

      if (evidenceError) {
        throw new Error(`保存證據包失敗：${evidenceError.message}`);
      }
    }

    // 4. 沒有任何核定事實時直接回覆資料不足，不呼叫模型
    if (evidence.length === 0) {
      await supabase
        .from("answer_sessions")
        .update({
          answer:
            "現有核定事實不足以回答這個問題：知識庫中沒有與這個問題相關的核定事實。請先匯入相關來源並核定事實。",
          insufficient_evidence: true,
          status: "draft",
        })
        .eq("id", session.id);

      revalidatePath("/ask");
      return {
        status: "success",
        sessionId: session.id,
        message: "沒有可用的核定事實，已如實回覆資料不足。",
      };
    }

    // 5. 呼叫模型
    const provider = createProvider(providerConfig());
    const checksum = await answerPromptChecksum();
    const { data: promptVersionId } = await supabase.rpc("upsert_prompt_version", {
      p_owner: user.id,
      p_name: ANSWER_PROMPT_NAME,
      p_purpose: "AI 問答",
      p_template: ANSWER_SYSTEM_PROMPT,
      p_checksum: checksum,
    });

    let answer: string;
    let modelRunId: string | null = null;

    try {
      const response = await provider.complete({
        messages: buildAnswerMessages(pack),
        temperature: 0,
      });
      answer = response.text.trim();

      const { data: run } = await supabase
        .from("model_runs")
        .insert({
          owner_id: user.id,
          prompt_version_id: promptVersionId ?? null,
          purpose: "answer_question",
          provider: response.provider,
          model: response.model,
          input_tokens: response.inputTokens,
          output_tokens: response.outputTokens,
          latency_ms: response.latencyMs,
          status: "completed",
        })
        .select("id")
        .single();

      modelRunId = run?.id ?? null;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await supabase
        .from("answer_sessions")
        .update({ status: "failed", error: message })
        .eq("id", session.id);
      throw new Error(`模型呼叫失敗：${message}`);
    }

    // 6. 引用了證據包以外的編號 → 視為幻覺，記錄下來供逐句驗證處理
    const unknown = findUnknownCitations(answer, pack);

    await supabase
      .from("answer_sessions")
      .update({
        answer,
        provider: provider.name,
        model: provider.model,
        prompt_version_id: promptVersionId ?? null,
        model_run_id: modelRunId,
        insufficient_evidence: declaresInsufficient(answer),
        error:
          unknown.length > 0
            ? `回答引用了證據包以外的知識編號：${unknown.join("、")}`
            : null,
      })
      .eq("id", session.id);

    // 7. 先拆句保存，Phase 7 的逐句驗證會填入判定結果
    const sentences = splitAnswerSentences(answer);
    if (sentences.length > 0) {
      await supabase.from("answer_sentences").insert(
        sentences.map((sentence, index) => ({
          owner_id: user.id,
          answer_session_id: session.id,
          position: index,
          sentence,
        })),
      );
    }

    revalidatePath("/ask");
    return {
      status: "success",
      sessionId: session.id,
      message: `已依 ${evidence.length} 筆核定事實作答。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "問答失敗",
    };
  }
}

/** 刪除問答紀錄。 */
export async function deleteAnswerSession(sessionId: string): Promise<AskResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("answer_sessions")
      .delete()
      .eq("id", sessionId);

    if (error) throw new Error(error.message);

    revalidatePath("/ask");
    return { status: "success", sessionId, message: "已刪除問答紀錄。" };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "刪除失敗",
    };
  }
}
