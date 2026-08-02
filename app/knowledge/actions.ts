"use server";

import { revalidatePath } from "next/cache";

import { validateStatement } from "@/lib/facts/review";
import { listApprovedPendingPromotion } from "@/lib/knowledge/queries";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { FactStatus, Json, RiskLevel } from "@/lib/supabase/types";

export type KnowledgeResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("尚未登入");
  return user;
}

function revalidateKnowledge(factId?: string) {
  revalidatePath("/knowledge");
  revalidatePath("/entities");
  revalidatePath("/relations");
  revalidatePath("/dashboard");
  if (factId) revalidatePath(`/knowledge/${factId}`);
}

function toError(cause: unknown): KnowledgeResult {
  return {
    status: "error",
    message: cause instanceof Error ? cause.message : "操作失敗",
  };
}

/**
 * 把單筆已核定的候選原子命題寫入正式原子命題庫。
 * 資料庫函式會一併建立版本紀錄、實體與關聯，並排入向量工作。
 */
export async function promoteCandidate(
  candidateId: string,
): Promise<KnowledgeResult> {
  try {
    await requireUser();
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("promote_candidate_fact", {
      p_candidate_id: candidateId,
    });

    if (error) throw new Error(error.message);
    if (!data) throw new Error("寫入正式原子命題失敗");

    revalidateKnowledge();
    return { status: "success", message: "已寫入正式原子命題庫，並排入向量工作。" };
  } catch (cause) {
    return toError(cause);
  }
}

/** 把所有尚未寫入的已核定候選原子命題批次轉為正式原子命題。 */
export async function promoteAllApproved(): Promise<KnowledgeResult> {
  try {
    await requireUser();
    const supabase = await createClient();
    const pending = await listApprovedPendingPromotion();

    if (pending.length === 0) {
      return { status: "error", message: "沒有待寫入的已核定原子命題" };
    }

    let promoted = 0;
    const failures: string[] = [];

    for (const candidate of pending) {
      const { error } = await supabase.rpc("promote_candidate_fact", {
        p_candidate_id: candidate.id,
      });
      if (error) failures.push(error.message);
      else promoted += 1;
    }

    revalidateKnowledge();

    return {
      status: "success",
      message:
        failures.length > 0
          ? `已寫入 ${promoted} 筆，${failures.length} 筆失敗：${failures[0]}`
          : `已寫入 ${promoted} 筆正式原子命題，並排入向量工作。`,
    };
  } catch (cause) {
    return toError(cause);
  }
}

/**
 * 修改正式原子命題。
 * 舊版標記為 superseded、舊向量停用，只為新版產生向量。
 */
export async function reviseFact(
  factId: string,
  statement: string,
  options: {
    riskLevel?: RiskLevel;
    conditions?: Record<string, string | null>;
    note?: string;
  } = {},
): Promise<KnowledgeResult> {
  try {
    await requireUser();

    const invalid = validateStatement(statement);
    if (invalid) return { status: "error", message: invalid };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("revise_knowledge_fact", {
      p_fact_id: factId,
      p_statement: statement.trim(),
      p_conditions: (options.conditions ?? null) as Json | null,
      p_risk_level: options.riskLevel ?? null,
      p_note: options.note ?? null,
    });

    if (error) throw new Error(error.message);

    revalidateKnowledge(typeof data === "string" ? data : undefined);
    return {
      status: "success",
      message: "已建立新版本，舊版標記為已取代，並只重做這一筆的向量。",
    };
  } catch (cause) {
    return toError(cause);
  }
}

/** 停用或恢復正式原子命題；停用時其向量一併退出搜尋。 */
export async function setFactStatus(
  factId: string,
  status: Extract<FactStatus, "active" | "inactive">,
): Promise<KnowledgeResult> {
  try {
    await requireUser();
    const supabase = await createClient();

    const { error } = await supabase.rpc("set_knowledge_fact_status", {
      p_fact_id: factId,
      p_status: status,
    });

    if (error) throw new Error(error.message);

    revalidateKnowledge(factId);
    return {
      status: "success",
      message:
        status === "active" ? "已恢復為現行原子命題。" : "已停用，向量退出搜尋。",
    };
  } catch (cause) {
    return toError(cause);
  }
}

/** 補齊缺少向量的原子命題（不會重建既有向量）。 */
export async function rebuildMissingEmbeddings(): Promise<KnowledgeResult> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { error } = await supabase.from("processing_jobs").insert({
      owner_id: user.id,
      job_type: "generate_embeddings",
      payload: {},
    });

    if (error) throw new Error(`建立向量工作失敗：${error.message}`);

    revalidateKnowledge();
    return { status: "success", message: "已排入向量補齊工作。" };
  } catch (cause) {
    return toError(cause);
  }
}
