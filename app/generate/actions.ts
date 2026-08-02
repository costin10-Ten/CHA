"use server";

import { revalidatePath } from "next/cache";

import {
  buildEvidencePack,
  formatKnowledgeRef,
  type EvidenceFact,
} from "@shared/answering.ts";
import {
  DRAFT_SPECS,
  GENERATION_PROMPT_NAME,
  GENERATION_SYSTEM_PROMPT,
  buildDraftTitle,
  buildGenerationMessages,
  generationPromptChecksum,
  isDraftType,
  summarizeDraft,
  verifyDraftBody,
  type DraftType,
} from "@shared/generation.ts";
import { createProvider } from "@shared/llm/factory.ts";
import type { VerificationFact } from "@shared/verification.ts";

import { searchKnowledgeFacts } from "@/lib/retrieval/search";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

/**
 * 風險溝通素材產製（工作單第 15 節）。
 *
 * 與問答同一條規則：只用核定原子命題、產出一律是草稿、
 * 產生後立刻逐句驗證，有紅色句子就標記為 blocked。
 */

const FACT_LIMIT = 12;

export type GenerateResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; draftId: string; message: string };

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

export interface GenerateInput {
  draftType: string;
  topic: string;
  audience?: string;
  tone?: string;
  /** 指定要使用的正式原子命題；未指定時以主題做混合搜尋。 */
  factIds?: string[];
}

export async function generateDraft(input: GenerateInput): Promise<GenerateResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    if (!isDraftType(input.draftType)) {
      return { status: "error", message: "不支援的素材類型" };
    }
    const topic = input.topic.trim();
    if (topic.length < 2) {
      return { status: "error", message: "請輸入主題" };
    }

    const draftType: DraftType = input.draftType;
    const audience = input.audience?.trim() || "一般民眾";
    const tone = input.tone?.trim() || "平實";

    const supabase = await createClient();

    // 1. 取得可用的核定原子命題
    const rows =
      input.factIds && input.factIds.length > 0
        ? ((
            await supabase
              .from("knowledge_facts")
              .select("*")
              .in("id", input.factIds)
              .eq("status", "active")
          ).data ?? [])
        : await searchKnowledgeFacts({ query: topic, limit: FACT_LIMIT });

    if (rows.length === 0) {
      return {
        status: "error",
        message: "找不到相關的核定原子命題。請先核定原子命題，或換一個主題。",
      };
    }

    const sourceIds = [...new Set(rows.map((row) => row.source_id))];
    const { data: sources } = await supabase
      .from("sources")
      .select("id, title, origin_url")
      .in("id", sourceIds);
    const sourceById = new Map((sources ?? []).map((item) => [item.id, item]));

    const evidence: EvidenceFact[] = rows.map((row, index) => {
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

    const pack = buildEvidencePack(topic, evidence);

    // 2. 產生素材
    const provider = createProvider(providerConfig());
    const checksum = await generationPromptChecksum();
    const { data: promptVersionId } = await supabase.rpc("upsert_prompt_version", {
      p_owner: user.id,
      p_name: GENERATION_PROMPT_NAME,
      p_purpose: "風險溝通素材產製",
      p_template: GENERATION_SYSTEM_PROMPT,
      p_checksum: checksum,
    });

    const response = await provider.complete({
      messages: buildGenerationMessages(pack, { draftType, audience, tone }),
      temperature: 0,
      maxTokens: 4000,
    });

    const body = response.text.trim();
    if (!body) throw new Error("模型沒有回傳內容");

    const { data: run } = await supabase
      .from("model_runs")
      .insert({
        owner_id: user.id,
        prompt_version_id: promptVersionId ?? null,
        purpose: "generate_content",
        provider: response.provider,
        model: response.model,
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
        latency_ms: response.latencyMs,
        status: "completed",
      })
      .select("id")
      .single();

    // 3. 逐句驗證，與問答使用同一套規則
    const facts: VerificationFact[] = evidence.map((fact) => ({
      knowledgeId: fact.knowledgeId,
      factId: fact.factId,
      statement: fact.statement,
      conditions: fact.conditions,
    }));

    const results = verifyDraftBody(body, facts);
    const summary = summarizeDraft(results);

    const { data: draft, error } = await supabase
      .from("communication_drafts")
      .insert({
        owner_id: user.id,
        draft_type: draftType,
        title: buildDraftTitle(draftType, topic),
        body,
        audience,
        tone,
        status: summary.unsupported > 0 ? "blocked" : "draft",
        knowledge_fact_ids: evidence.map((fact) => fact.factId),
        knowledge_refs: evidence.map((fact) => fact.knowledgeId),
        provider: response.provider,
        model: response.model,
        prompt_version_id: promptVersionId ?? null,
        model_run_id: run?.id ?? null,
        verified_at: new Date().toISOString(),
        supported_count: summary.supported,
        partial_count: summary.partial,
        unsupported_count: summary.unsupported,
        publishable: summary.publishable,
        verification: results as unknown as Json,
      })
      .select("id")
      .single();

    if (error || !draft) throw new Error(`保存草稿失敗：${error?.message}`);

    revalidatePath("/generate");
    return {
      status: "success",
      draftId: draft.id,
      message: summary.publishable
        ? `已產生${DRAFT_SPECS[draftType].label}草稿，逐句驗證通過。`
        : `已產生${DRAFT_SPECS[draftType].label}草稿，但有 ${summary.unsupported} 句沒有原子命題支持，已標記為阻擋。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "產製失敗",
    };
  }
}

/** 使用者修改後重新驗證，維持「發布前一定驗證過」的保證。 */
export async function updateDraftBody(
  draftId: string,
  editedBody: string,
): Promise<GenerateResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    const supabase = await createClient();
    const { data: draft, error: loadError } = await supabase
      .from("communication_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (loadError || !draft) throw new Error("找不到草稿");

    const { data: factRows } = await supabase
      .from("knowledge_facts")
      .select("id, statement, conditions")
      .in("id", draft.knowledge_fact_ids);

    const facts: VerificationFact[] = (factRows ?? []).map((row) => {
      const index = draft.knowledge_fact_ids.indexOf(row.id);
      return {
        knowledgeId: draft.knowledge_refs[index] ?? formatKnowledgeRef(index),
        factId: row.id,
        statement: row.statement,
        conditions: (row.conditions ?? {}) as Record<string, string | null>,
      };
    });

    const results = verifyDraftBody(editedBody, facts);
    const summary = summarizeDraft(results);

    const { error } = await supabase
      .from("communication_drafts")
      .update({
        edited_body: editedBody,
        status: summary.unsupported > 0 ? "blocked" : "edited",
        verified_at: new Date().toISOString(),
        supported_count: summary.supported,
        partial_count: summary.partial,
        unsupported_count: summary.unsupported,
        publishable: summary.publishable,
        verification: results as unknown as Json,
      })
      .eq("id", draftId);

    if (error) throw new Error(`更新草稿失敗：${error.message}`);

    revalidatePath("/generate");
    revalidatePath(`/generate/${draftId}`);

    return {
      status: "success",
      draftId,
      message: summary.publishable
        ? "已儲存並重新驗證，內容可發布。"
        : `已儲存，但仍有 ${summary.unsupported} 句沒有原子命題支持。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "更新失敗",
    };
  }
}

/** 標記為定稿。有紅色句子時不允許。 */
export async function finalizeDraft(draftId: string): Promise<GenerateResult> {
  try {
    const supabase = await createClient();
    const { data: draft } = await supabase
      .from("communication_drafts")
      .select("publishable")
      .eq("id", draftId)
      .single();

    if (!draft) throw new Error("找不到草稿");
    if (!draft.publishable) {
      return {
        status: "error",
        message: "仍有沒有原子命題支持的句子，無法定稿。請先修正紅色句子。",
      };
    }

    const { error } = await supabase
      .from("communication_drafts")
      .update({ status: "final" })
      .eq("id", draftId);

    if (error) throw new Error(error.message);

    revalidatePath("/generate");
    revalidatePath(`/generate/${draftId}`);
    return { status: "success", draftId, message: "已標記為定稿。" };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "定稿失敗",
    };
  }
}

export async function deleteDraft(draftId: string): Promise<GenerateResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("communication_drafts")
      .delete()
      .eq("id", draftId);

    if (error) throw new Error(error.message);

    revalidatePath("/generate");
    return { status: "success", draftId, message: "已刪除草稿。" };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "刪除失敗",
    };
  }
}
