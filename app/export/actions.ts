"use server";

import { revalidatePath } from "next/cache";

import type { FactConditions, RawFact } from "@shared/extraction.ts";
import { sha256Hex } from "@shared/hash.ts";
import {
  findImmutableViolations,
  parseCandidatePack,
  type ReturnedFact,
} from "@shared/pack.ts";
import { checkFactQuality, normalizeForCompare } from "@shared/quality.ts";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type {
  CandidateFactRow,
  Json,
  KnowledgeType,
  RiskLevel,
} from "@/lib/supabase/types";

/**
 * 匯入待選事實包的回填結果。
 *
 * 三條不可退讓的規則：
 * 1. 回填不得核定任何事實，狀態一律維持「待審核」。
 * 2. 回填內容一樣要跑 checkFactQuality，不能繞過品質檢查。
 * 3. 不可修改的來源欄位若被動過，整筆拒絕。
 */

export type ImportResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      applied: number;
      noted: number;
      skipped: number;
      problems: string[];
    };

function conditionsOf(
  returned: ReturnedFact,
  original: CandidateFactRow,
): FactConditions {
  const base = (original.conditions ?? {}) as Record<string, string | null>;
  const merged = { ...base, ...(returned.conditions ?? {}) };

  return {
    population: merged.population ?? null,
    exposure_route: merged.exposure_route ?? null,
    dose: merged.dose ?? null,
    duration: merged.duration ?? null,
    location: merged.location ?? null,
    timeframe: merged.timeframe ?? null,
  };
}

export async function importCandidatePack(json: string): Promise<ImportResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    if (!json.trim()) {
      return { status: "error", message: "請貼上回填的 JSON 內容" };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      return { status: "error", message: "不是合法的 JSON，請確認內容完整貼上" };
    }

    const parsed = parseCandidatePack(payload);
    if (parsed.facts.length === 0) {
      return {
        status: "error",
        message:
          parsed.errors.length > 0
            ? `回填內容無法使用：${parsed.errors[0]}`
            : "回填內容沒有任何事實",
      };
    }

    const supabase = await createClient();
    const ids = parsed.facts.map((fact) => fact.id);

    const { data: originals, error: loadError } = await supabase
      .from("candidate_facts")
      .select("*")
      .in("id", ids);

    if (loadError) throw new Error(`讀取候選事實失敗：${loadError.message}`);

    const originalById = new Map((originals ?? []).map((row) => [row.id, row]));
    const problems = [...parsed.errors];

    let applied = 0;
    let noted = 0;
    let skipped = 0;

    for (const returned of parsed.facts) {
      const original = originalById.get(returned.id);
      if (!original) {
        problems.push(
          `${returned.id}：找不到對應的候選事實（可能不屬於你或已刪除）`,
        );
        skipped += 1;
        continue;
      }

      const violations = findImmutableViolations(returned, original);
      if (violations.length > 0) {
        problems.push(
          `${original.statement.slice(0, 20)}…：不可修改的欄位被更動（${violations.join("、")}），已拒絕`,
        );
        skipped += 1;
        continue;
      }

      // ok／reject／uncertain 只留意見，不動內容。
      const wantsEdit =
        returned.verdict === "revised" ||
        (returned.verdict === undefined && returned.statement !== undefined);

      if (!wantsEdit) {
        await recordExternalReview(original, returned, user.id, null);
        if (returned.correction_reason) {
          await supabase
            .from("candidate_facts")
            .update({
              review_note: externalNote(returned),
            })
            .eq("id", original.id);
        }
        noted += 1;
        continue;
      }

      const statement = (returned.statement ?? original.statement).trim();
      if (statement.length < 4) {
        problems.push(`${returned.id}：修正後的敘述太短，已拒絕`);
        skipped += 1;
        continue;
      }

      // 取回原文段落，用與 AI 抽取時同一套規則重新檢查。
      const { data: chunk } = await supabase
        .from("document_chunks")
        .select("text")
        .eq("source_version_id", original.source_version_id)
        .eq("paragraph_id", original.source_paragraph_id)
        .maybeSingle();

      const conditions = conditionsOf(returned, original);
      const candidate: RawFact = {
        statement,
        subject: returned.subject ?? original.subject,
        predicate: returned.predicate ?? original.predicate,
        object: returned.object ?? original.object,
        knowledge_type: returned.knowledge_type ?? original.knowledge_type,
        conditions,
        source_quote: original.source_quote,
        source_paragraph_id: original.source_paragraph_id,
        risk_level: returned.risk_level ?? original.risk_level,
        confidence: original.confidence,
      };

      const quality = checkFactQuality(candidate, {
        paragraphText: chunk?.text ?? original.source_quote,
      });

      if (quality.fatal) {
        problems.push(
          `${statement.slice(0, 20)}…：修正後的敘述在原文中找不到依據，已拒絕`,
        );
        skipped += 1;
        continue;
      }

      const { error } = await supabase
        .from("candidate_facts")
        .update({
          statement,
          subject: candidate.subject,
          predicate: candidate.predicate,
          object: candidate.object,
          knowledge_type: candidate.knowledge_type as KnowledgeType,
          risk_level: candidate.risk_level as RiskLevel,
          conditions,
          quality_flags: quality.flags,
          quality_score: quality.score,
          statement_hash: await sha256Hex(normalizeForCompare(statement)),
          // 回填絕不核定，維持待審核。
          status: "pending",
          edited: true,
          original_statement: original.original_statement ?? original.statement,
          review_note: externalNote(returned),
        })
        .eq("id", original.id);

      if (error) {
        problems.push(`${returned.id}：更新失敗（${error.message}）`);
        skipped += 1;
        continue;
      }

      await recordExternalReview(original, returned, user.id, statement);
      applied += 1;
    }

    revalidatePath("/review");
    revalidatePath("/export");

    return {
      status: "success",
      applied,
      noted,
      skipped,
      problems,
      message: `已回填 ${applied} 筆修正、${noted} 筆僅記錄意見、${skipped} 筆被拒絕。所有回填結果都維持在待審核，需要你逐筆確認。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "匯入失敗",
    };
  }
}

function externalNote(returned: ReturnedFact): string {
  const verdict = returned.verdict ?? "revised";
  const reason = returned.correction_reason ?? "（未說明理由）";
  return `外部 LLM 校正（${verdict}）：${reason}`;
}

async function recordExternalReview(
  original: CandidateFactRow,
  returned: ReturnedFact,
  ownerId: string,
  newStatement: string | null,
): Promise<void> {
  const supabase = await createClient();

  await supabase.from("review_records").insert({
    owner_id: ownerId,
    candidate_fact_id: original.id,
    source_id: original.source_id,
    action: "external_correction",
    from_status: original.status,
    to_status: "pending",
    note: externalNote(returned),
    changes: (newStatement
      ? { statement: { from: original.statement, to: newStatement } }
      : {}) as Json,
  });
}
