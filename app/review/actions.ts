"use server";

import { revalidatePath } from "next/cache";

import { checkFactQuality } from "@shared/quality.ts";
import type { RawFact } from "@shared/extraction.ts";
import { sha256Hex } from "@shared/hash.ts";
import { normalizeForCompare } from "@shared/quality.ts";

import {
  assertActionAllowed,
  buildChanges,
  isBatchReviewable,
  parseSplitStatements,
  validateMerge,
  validateSplit,
  validateStatement,
  type EditableFields,
  type ReviewAction,
} from "@/lib/facts/review";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { CandidateFactRow, CandidateStatus, Json } from "@/lib/supabase/types";

export type ReviewResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("尚未登入");
  return user;
}

async function loadFact(id: string): Promise<CandidateFactRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidate_facts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) throw new Error("找不到候選事實");
  return data;
}

interface ReviewLog {
  ownerId: string;
  factId: string | null;
  sourceId: string | null;
  action: ReviewAction;
  fromStatus: CandidateStatus | null;
  toStatus: CandidateStatus | null;
  note?: string | null;
  changes?: Json;
  relatedIds?: string[];
}

/** 每一個審核動作都必須留下紀錄，審核歷程才可追溯。 */
async function recordReview(log: ReviewLog): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("review_records").insert({
    owner_id: log.ownerId,
    candidate_fact_id: log.factId,
    source_id: log.sourceId,
    action: log.action,
    from_status: log.fromStatus,
    to_status: log.toStatus,
    note: log.note ?? null,
    changes: log.changes ?? {},
    related_ids: log.relatedIds ?? [],
  });

  if (error) throw new Error(`寫入審核紀錄失敗：${error.message}`);
}

/**
 * 核定後立即寫入正式事實庫。
 * 失敗不回滾核定狀態，只把原因回報給使用者（可在 /knowledge 重試）。
 */
async function promoteApproved(candidateId: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("promote_candidate_fact", {
    p_candidate_id: candidateId,
  });
  return error ? error.message : null;
}

function revalidateReview(sourceId?: string | null) {
  revalidatePath("/review");
  revalidatePath("/dashboard");
  if (sourceId) revalidatePath(`/sources/${sourceId}`);
}

function toResult(cause: unknown): ReviewResult {
  return {
    status: "error",
    message: cause instanceof Error ? cause.message : "操作失敗",
  };
}

/** 核定、駁回、標記待確認、退回待審核共用同一條路徑。 */
async function applySimpleAction(
  id: string,
  action: Extract<ReviewAction, "approve" | "reject" | "needs_fix" | "reopen">,
  toStatus: CandidateStatus,
  note?: string,
): Promise<ReviewResult> {
  try {
    const user = await requireUser();
    const fact = await loadFact(id);

    const blocked = assertActionAllowed(fact.status, action);
    if (blocked) return { status: "error", message: blocked };

    const supabase = await createClient();
    const { error } = await supabase
      .from("candidate_facts")
      .update({
        status: toStatus,
        reviewed_at: new Date().toISOString(),
        review_note: note ?? null,
      })
      .eq("id", id);

    if (error) throw new Error(`更新狀態失敗：${error.message}`);

    await recordReview({
      ownerId: user.id,
      factId: id,
      sourceId: fact.source_id,
      action,
      fromStatus: fact.status,
      toStatus,
      note,
    });

    const promoteError = action === "approve" ? await promoteApproved(id) : null;

    revalidateReview(fact.source_id);
    revalidatePath("/knowledge");

    return {
      status: "success",
      message: promoteError
        ? `已核定，但寫入正式事實庫失敗：${promoteError}`
        : action === "approve"
          ? "已核定並寫入正式事實庫。"
          : "已更新審核狀態。",
    };
  } catch (cause) {
    return toResult(cause);
  }
}

export async function approveCandidate(id: string, note?: string) {
  return applySimpleAction(id, "approve", "approved", note);
}

export async function rejectCandidate(id: string, note?: string) {
  return applySimpleAction(id, "reject", "rejected", note);
}

export async function markNeedsFix(id: string, note?: string) {
  return applySimpleAction(id, "needs_fix", "needs_fix", note);
}

export async function reopenCandidate(id: string, note?: string) {
  return applySimpleAction(id, "reopen", "pending", note);
}

export interface EditInput extends EditableFields {
  note?: string;
}

/**
 * 修正後核定。
 * 修改敘述後會用同一份自動品質檢查重新評分，避免手動修改繞過檢查。
 */
export async function approveWithEdit(
  id: string,
  input: EditInput,
): Promise<ReviewResult> {
  try {
    const user = await requireUser();
    const fact = await loadFact(id);

    const blocked = assertActionAllowed(fact.status, "approve_with_edit");
    if (blocked) return { status: "error", message: blocked };

    const invalid = validateStatement(input.statement);
    if (invalid) return { status: "error", message: invalid };

    const supabase = await createClient();

    // 取回原文段落，重新執行品質檢查。
    const { data: chunk } = await supabase
      .from("document_chunks")
      .select("text")
      .eq("source_version_id", fact.source_version_id)
      .eq("paragraph_id", fact.source_paragraph_id)
      .maybeSingle();

    const edited: RawFact = {
      statement: input.statement.trim(),
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      knowledge_type: input.knowledge_type,
      conditions: {
        population: input.conditions.population ?? null,
        exposure_route: input.conditions.exposure_route ?? null,
        dose: input.conditions.dose ?? null,
        duration: input.conditions.duration ?? null,
        location: input.conditions.location ?? null,
        timeframe: input.conditions.timeframe ?? null,
      },
      source_quote: fact.source_quote,
      source_paragraph_id: fact.source_paragraph_id,
      risk_level: input.risk_level,
      confidence: fact.confidence,
    };

    const quality = checkFactQuality(edited, {
      paragraphText: chunk?.text ?? fact.source_quote,
    });

    if (quality.fatal) {
      return {
        status: "error",
        message: "修正後的事實仍缺少有效的原文片段，無法核定。",
      };
    }

    const changes = buildChanges(
      {
        statement: fact.statement,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        knowledge_type: fact.knowledge_type,
        risk_level: fact.risk_level,
        conditions: fact.conditions as unknown as Record<string, string | null>,
      },
      {
        statement: edited.statement,
        subject: edited.subject,
        predicate: edited.predicate,
        object: edited.object,
        knowledge_type: edited.knowledge_type,
        risk_level: edited.risk_level,
        conditions: edited.conditions as unknown as Record<string, string | null>,
      },
    );

    const { error } = await supabase
      .from("candidate_facts")
      .update({
        statement: edited.statement,
        subject: edited.subject,
        predicate: edited.predicate,
        object: edited.object,
        knowledge_type: edited.knowledge_type as CandidateFactRow["knowledge_type"],
        risk_level: edited.risk_level as CandidateFactRow["risk_level"],
        conditions: edited.conditions,
        quality_flags: quality.flags,
        quality_score: quality.score,
        statement_hash: await sha256Hex(normalizeForCompare(edited.statement)),
        status: "approved",
        edited: true,
        original_statement: fact.original_statement ?? fact.statement,
        reviewed_at: new Date().toISOString(),
        review_note: input.note ?? null,
      })
      .eq("id", id);

    if (error) throw new Error(`更新事實失敗：${error.message}`);

    await recordReview({
      ownerId: user.id,
      factId: id,
      sourceId: fact.source_id,
      action: "approve_with_edit",
      fromStatus: fact.status,
      toStatus: "approved",
      note: input.note,
      changes: changes as Json,
    });

    const promoteError = await promoteApproved(id);

    revalidateReview(fact.source_id);
    revalidatePath("/knowledge");

    return {
      status: "success",
      message: promoteError
        ? `已修正並核定，但寫入正式事實庫失敗：${promoteError}`
        : "已修正並核定，已寫入正式事實庫。",
    };
  } catch (cause) {
    return toResult(cause);
  }
}

/** 拆成多筆：原事實標為 split，每一行建立一筆新的待審核事實。 */
export async function splitCandidate(
  id: string,
  input: string,
  note?: string,
): Promise<ReviewResult> {
  try {
    const user = await requireUser();
    const fact = await loadFact(id);

    const blocked = assertActionAllowed(fact.status, "split");
    if (blocked) return { status: "error", message: blocked };

    const statements = parseSplitStatements(input);
    const invalid = validateSplit(statements);
    if (invalid) return { status: "error", message: invalid };

    const supabase = await createClient();
    const rows = await Promise.all(
      statements.map(async (statement) => ({
        owner_id: user.id,
        source_id: fact.source_id,
        source_version_id: fact.source_version_id,
        document_chunk_id: fact.document_chunk_id,
        statement,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        knowledge_type: fact.knowledge_type,
        conditions: fact.conditions,
        source_quote: fact.source_quote,
        source_paragraph_id: fact.source_paragraph_id,
        risk_level: fact.risk_level,
        confidence: fact.confidence,
        status: "pending" as CandidateStatus,
        quality_flags: [],
        quality_score: 100,
        statement_hash: await sha256Hex(normalizeForCompare(statement)),
        prompt_version_id: fact.prompt_version_id,
        model_run_id: fact.model_run_id,
        extraction_batch: fact.extraction_batch,
        parent_fact_id: fact.id,
        edited: true,
      })),
    );

    const { data: created, error } = await supabase
      .from("candidate_facts")
      .upsert(rows, {
        onConflict: "source_version_id,statement_hash",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) throw new Error(`建立拆分後的事實失敗：${error.message}`);

    await supabase
      .from("candidate_facts")
      .update({ status: "split", reviewed_at: new Date().toISOString() })
      .eq("id", id);

    await recordReview({
      ownerId: user.id,
      factId: id,
      sourceId: fact.source_id,
      action: "split",
      fromStatus: fact.status,
      toStatus: "split",
      note,
      changes: { statements } as Json,
      relatedIds: (created ?? []).map((row) => row.id),
    });

    revalidateReview(fact.source_id);
    return {
      status: "success",
      message: `已拆成 ${created?.length ?? 0} 筆待審核事實。`,
    };
  } catch (cause) {
    return toResult(cause);
  }
}

/** 合併多筆：建立一筆新的待審核事實，來源事實標為 merged。 */
export async function mergeCandidates(
  ids: string[],
  statement: string,
  note?: string,
): Promise<ReviewResult> {
  try {
    const user = await requireUser();

    const invalidSelection = validateMerge(ids);
    if (invalidSelection) return { status: "error", message: invalidSelection };

    const invalidStatement = validateStatement(statement);
    if (invalidStatement) return { status: "error", message: invalidStatement };

    const supabase = await createClient();
    const { data: facts, error: loadError } = await supabase
      .from("candidate_facts")
      .select("*")
      .in("id", ids);

    if (loadError || !facts || facts.length < 2) {
      return { status: "error", message: "找不到要合併的候選事實" };
    }

    const sameVersion = facts.every(
      (fact) => fact.source_version_id === facts[0].source_version_id,
    );
    if (!sameVersion) {
      return { status: "error", message: "只能合併同一份文件版本內的候選事實" };
    }

    for (const fact of facts) {
      const blocked = assertActionAllowed(fact.status, "merge");
      if (blocked) return { status: "error", message: blocked };
    }

    const base = facts[0];
    const mergedQuote = facts
      .map((fact) => fact.source_quote)
      .filter((quote, index, all) => all.indexOf(quote) === index)
      .join(" ");

    const { data: created, error } = await supabase
      .from("candidate_facts")
      .insert({
        owner_id: user.id,
        source_id: base.source_id,
        source_version_id: base.source_version_id,
        document_chunk_id: base.document_chunk_id,
        statement: statement.trim(),
        subject: base.subject,
        predicate: base.predicate,
        object: base.object,
        knowledge_type: base.knowledge_type,
        conditions: base.conditions,
        source_quote: mergedQuote,
        source_paragraph_id: base.source_paragraph_id,
        risk_level: facts.some((fact) => fact.risk_level === "high")
          ? "high"
          : base.risk_level,
        confidence: base.confidence,
        status: "pending",
        quality_flags: [],
        quality_score: 100,
        statement_hash: await sha256Hex(normalizeForCompare(statement)),
        parent_fact_id: base.id,
        edited: true,
      })
      .select("id")
      .single();

    if (error || !created)
      throw new Error(`建立合併後的事實失敗：${error?.message}`);

    await supabase
      .from("candidate_facts")
      .update({
        status: "merged",
        merged_into: created.id,
        reviewed_at: new Date().toISOString(),
      })
      .in("id", ids);

    await recordReview({
      ownerId: user.id,
      factId: created.id,
      sourceId: base.source_id,
      action: "merge",
      fromStatus: "pending",
      toStatus: "merged",
      note,
      relatedIds: ids,
    });

    revalidateReview(base.source_id);
    return {
      status: "success",
      message: `已將 ${ids.length} 筆合併為一筆待審核事實。`,
    };
  } catch (cause) {
    return toResult(cause);
  }
}

/** 批次核定或批次駁回。 */
export async function batchReview(
  ids: string[],
  action: Extract<ReviewAction, "approve" | "reject" | "needs_fix">,
  note?: string,
): Promise<ReviewResult> {
  try {
    const user = await requireUser();
    if (ids.length === 0) return { status: "error", message: "沒有選取任何項目" };

    const supabase = await createClient();
    const { data: facts, error: loadError } = await supabase
      .from("candidate_facts")
      .select("id, status, source_id")
      .in("id", ids);

    if (loadError || !facts) throw new Error("讀取候選事實失敗");

    // 批次操作只作用於「還沒做決定」的候選事實。
    // 已核定／已駁回要改判，必須到單筆審核頁明確操作。
    const allowed = facts.filter(
      (fact) =>
        isBatchReviewable(fact.status) &&
        !assertActionAllowed(fact.status, action),
    );
    if (allowed.length === 0) {
      return {
        status: "error",
        message:
          "選取的項目都不是待審核或待確認狀態。已核定或已駁回的事實要改判，請進入單筆審核頁。",
      };
    }

    const toStatus: CandidateStatus =
      action === "approve"
        ? "approved"
        : action === "reject"
          ? "rejected"
          : "needs_fix";

    const { error } = await supabase
      .from("candidate_facts")
      .update({
        status: toStatus,
        reviewed_at: new Date().toISOString(),
        review_note: note ?? null,
      })
      .in(
        "id",
        allowed.map((fact) => fact.id),
      );

    if (error) throw new Error(`批次更新失敗：${error.message}`);

    for (const fact of allowed) {
      await recordReview({
        ownerId: user.id,
        factId: fact.id,
        sourceId: fact.source_id,
        action,
        fromStatus: fact.status,
        toStatus,
        note: note ?? "批次操作",
      });
    }

    if (action === "approve") {
      for (const fact of allowed) {
        await promoteApproved(fact.id);
      }
      revalidatePath("/knowledge");
    }

    revalidateReview(allowed[0]?.source_id);
    const skipped = ids.length - allowed.length;
    return {
      status: "success",
      message:
        skipped > 0
          ? `已處理 ${allowed.length} 筆，${skipped} 筆因狀態不允許而略過。`
          : `已處理 ${allowed.length} 筆。`,
    };
  } catch (cause) {
    return toResult(cause);
  }
}

/** 重新抽取某個段落的候選事實。 */
export async function reextractParagraph(
  sourceId: string,
  paragraphId: string,
): Promise<ReviewResult> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { error } = await supabase.from("processing_jobs").insert({
      owner_id: user.id,
      job_type: "extract_facts",
      source_id: sourceId,
      payload: { paragraph_ids: [paragraphId] },
    });

    if (error) throw new Error(`建立抽取工作失敗：${error.message}`);

    await recordReview({
      ownerId: user.id,
      factId: null,
      sourceId,
      action: "reextract",
      fromStatus: null,
      toStatus: null,
      note: `重新抽取段落 ${paragraphId}`,
    });

    revalidateReview(sourceId);
    return {
      status: "success",
      message: `已排入段落 ${paragraphId} 的重新抽取工作。`,
    };
  } catch (cause) {
    return toResult(cause);
  }
}
