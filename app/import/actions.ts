"use server";

import { revalidatePath } from "next/cache";

import { validateArticlePack, type PackIssue } from "@shared/article-pack.ts";
import type { FactConditions } from "@shared/extraction.ts";
import { contentHash, sha256Hex } from "@shared/hash.ts";
import { normalizeForCompare } from "@shared/quality.ts";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type {
  CandidateStatus,
  Json,
  KnowledgeType,
  ReviewActionType,
  RiskLevel,
} from "@/lib/supabase/types";

/**
 * 匯入文章包（在對話或其他工具中整理好的一篇文章）。
 *
 * 規則與一般匯入完全一致：
 * - 每一筆事實都必須有能在段落中找到的原文引句（驗證階段就擋下）
 * - 正式事實一律由候選事實經 promote_candidate_fact 產生，不直接插入，
 *   版本、fact_versions 與實體關聯才會與系統其他路徑一致
 * - 預設不信任檔案裡的審核狀態，全部以「待審核」匯入；
 *   要沿用檔案中的人工核定結果，必須明確勾選
 */

export interface ValidateResult {
  ok: boolean;
  issues: PackIssue[];
  summary: {
    chunks: number;
    candidates: number;
    approved: number;
    rejected: number;
    knowledgeFacts: number;
    reviews: number;
  };
  title: string | null;
  originUrl: string | null;
  humanReview: string | null;
}

export async function validatePack(json: string): Promise<ValidateResult> {
  const parsed = parseJson(json);
  if ("error" in parsed) {
    return {
      ok: false,
      issues: [{ level: "error", where: "檔案", message: parsed.error }],
      summary: {
        chunks: 0,
        candidates: 0,
        approved: 0,
        rejected: 0,
        knowledgeFacts: 0,
        reviews: 0,
      },
      title: null,
      originUrl: null,
      humanReview: null,
    };
  }

  const result = validateArticlePack(parsed.value);
  const meta = (parsed.value as { export_meta?: Record<string, unknown> })
    .export_meta;

  return {
    ok: result.ok,
    issues: result.issues,
    summary: result.summary,
    title: result.pack?.sources[0].title ?? null,
    originUrl: result.pack?.sources[0].origin_url ?? null,
    humanReview: typeof meta?.human_review === "string" ? meta.human_review : null,
  };
}

export type ImportPackResult =
  | { status: "idle" }
  | { status: "error"; message: string; issues?: PackIssue[] }
  | {
      status: "success";
      message: string;
      sourceId: string;
      created: {
        chunks: number;
        candidates: number;
        reviews: number;
        knowledgeFacts: number;
      };
      problems: string[];
    };

/** 條件欄位固定六個鍵，缺的補 null，與抽取管線輸出一致。 */
function normalizeConditions(
  input: Record<string, string | null> | undefined,
): FactConditions {
  const source = input ?? {};
  return {
    population: source.population ?? null,
    exposure_route: source.exposure_route ?? null,
    dose: source.dose ?? null,
    duration: source.duration ?? null,
    location: source.location ?? null,
    timeframe: source.timeframe ?? null,
  };
}

function parseJson(json: string): { value: unknown } | { error: string } {
  if (!json.trim()) return { error: "請貼上或上傳文章包 JSON" };
  try {
    return { value: JSON.parse(json) };
  } catch {
    return { error: "不是合法的 JSON，請確認檔案完整" };
  }
}

export async function importArticlePack(
  json: string,
  options: { trustHumanReview?: boolean } = {},
): Promise<ImportPackResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    const parsed = parseJson(json);
    if ("error" in parsed) return { status: "error", message: parsed.error };

    const validation = validateArticlePack(parsed.value);
    if (!validation.ok || !validation.pack) {
      return {
        status: "error",
        message: "文章包未通過驗證，沒有匯入任何資料。",
        issues: validation.issues,
      };
    }

    const pack = validation.pack;
    const supabase = await createClient();
    const source = pack.sources[0];

    // 同一個網址已經匯入過就擋下，避免無聲產生重複的知識。
    if (source.origin_url) {
      const { data: existing } = await supabase
        .from("sources")
        .select("id, title")
        .eq("origin_url", source.origin_url)
        .maybeSingle();

      if (existing) {
        return {
          status: "error",
          message: `這個網址已經匯入過（${existing.title}）。若要更新內容，請到來源頁重新解析，不要重複匯入。`,
        };
      }
    }

    const problems: string[] = validation.issues
      .filter((issue) => issue.level === "warning")
      .map((issue) => `${issue.where}：${issue.message}`);

    // --- 1. sources ------------------------------------------------------
    const packVersion = pack.source_versions[0];
    const fullText = pack.document_chunks.map((chunk) => chunk.text).join("\n\n");
    const sourceHash = source.content_hash ?? (await contentHash(fullText));

    const { data: createdSource, error: sourceError } = await supabase
      .from("sources")
      .insert({
        owner_id: user.id,
        title: source.title,
        source_type: source.source_type as "text" | "file" | "url",
        origin_url: source.origin_url,
        mime_type: source.mime_type,
        byte_size: source.byte_size,
        content_hash: sourceHash,
        current_version: 1,
        status: "ready",
        fetched_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (sourceError || !createdSource) {
      throw new Error(`建立來源失敗：${sourceError?.message}`);
    }

    // --- 2. source_versions ---------------------------------------------
    const { data: createdVersion, error: versionError } = await supabase
      .from("source_versions")
      .insert({
        owner_id: user.id,
        source_id: createdSource.id,
        version: 1,
        title: packVersion.title,
        raw_text: packVersion.raw_text ?? fullText,
        content_hash: sourceHash,
        parser_version: packVersion.parser_version ?? "article-pack/1.0",
        char_count: packVersion.char_count || fullText.length,
        chunk_count: pack.document_chunks.length,
        is_current: true,
        fetched_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (versionError || !createdVersion) {
      throw new Error(`建立來源版本失敗：${versionError?.message}`);
    }

    // --- 3. document_chunks ---------------------------------------------
    // char_start／char_end 若檔案沒給就依段落順序推算，前後文才有意義。
    let offset = 0;
    const chunkRows = await Promise.all(
      pack.document_chunks.map(async (chunk, index) => {
        const start = chunk.char_start || offset;
        const end = chunk.char_end || start + chunk.text.length;
        offset = end + 2;

        return {
          owner_id: user.id,
          source_id: createdSource.id,
          source_version_id: createdVersion.id,
          paragraph_id: chunk.paragraph_id,
          position: chunk.position ?? index,
          block_type: chunk.block_type ?? "paragraph",
          heading_path: chunk.heading_path ?? [],
          text: chunk.text,
          char_start: start,
          char_end: end,
          content_hash: await contentHash(chunk.text),
        };
      }),
    );

    const { data: createdChunks, error: chunkError } = await supabase
      .from("document_chunks")
      .insert(chunkRows)
      .select("id, paragraph_id");

    if (chunkError || !createdChunks) {
      throw new Error(`建立段落失敗：${chunkError?.message}`);
    }

    const chunkIdByParagraph = new Map(
      createdChunks.map((chunk) => [chunk.paragraph_id, chunk.id]),
    );

    // --- 4. processing_jobs（保存 AI 審核紀錄）-----------------------------
    for (const job of pack.processing_jobs) {
      await supabase.from("processing_jobs").insert({
        owner_id: user.id,
        job_type: "extract_facts",
        source_id: createdSource.id,
        status: "completed",
        progress: 100,
        payload: (job.payload ?? {}) as Json,
        result: (job.result ?? {}) as Json,
        finished_at: new Date().toISOString(),
      });
    }

    // --- 5. candidate_facts ----------------------------------------------
    const trust = options.trustHumanReview === true;

    const candidateRows = await Promise.all(
      pack.candidate_facts.map(async (candidate) => ({
        owner_id: user.id,
        source_id: createdSource.id,
        source_version_id: createdVersion.id,
        document_chunk_id:
          chunkIdByParagraph.get(candidate.source_paragraph_id) ?? null,
        statement: candidate.statement,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        knowledge_type: (candidate.knowledge_type ?? "other") as KnowledgeType,
        conditions: normalizeConditions(candidate.conditions),
        source_quote: candidate.source_quote,
        source_paragraph_id: candidate.source_paragraph_id,
        risk_level: (candidate.risk_level ?? "low") as RiskLevel,
        confidence: candidate.confidence ?? 0.5,
        // 不信任檔案審核結果時，一律以待審核進入系統。
        status: (trust
          ? (candidate.status ?? "pending")
          : "pending") as CandidateStatus,
        quality_flags: candidate.quality_flags ?? [],
        quality_score: candidate.quality_score ?? 100,
        // 雜湊一律重算，才能和系統其他路徑用同一套規則去重。
        statement_hash: await sha256Hex(normalizeForCompare(candidate.statement)),
        extraction_batch: candidate.extraction_batch,
        review_note: candidate.review_note,
        edited: candidate.edited ?? false,
        original_statement: candidate.original_statement,
        reviewed_at:
          trust && candidate.status !== "pending" ? new Date().toISOString() : null,
      })),
    );

    const { data: createdCandidates, error: candidateError } = await supabase
      .from("candidate_facts")
      .insert(candidateRows)
      .select("id, statement");

    if (candidateError || !createdCandidates) {
      throw new Error(`建立候選事實失敗：${candidateError?.message}`);
    }

    // 以敘述對回 ref：同一篇文章內敘述唯一，插入順序也一致。
    const candidateIdByRef = new Map<string, string>();
    pack.candidate_facts.forEach((candidate, index) => {
      const created = createdCandidates[index];
      if (created) candidateIdByRef.set(candidate.ref, created.id);
    });

    // --- 6. review_records ------------------------------------------------
    const reviewRows = pack.review_records
      .map((review) => {
        const candidateId = candidateIdByRef.get(review.candidate_fact_id);
        if (!candidateId) return null;

        return {
          owner_id: user.id,
          candidate_fact_id: candidateId,
          source_id: createdSource.id,
          action: review.action as ReviewActionType,
          from_status: (review.from_status ?? null) as CandidateStatus | null,
          to_status: (review.to_status ?? null) as CandidateStatus | null,
          note: review.note,
          changes: (review.changes ?? {}) as Json,
          related_ids: [],
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (reviewRows.length > 0) {
      const { error } = await supabase.from("review_records").insert(reviewRows);
      if (error) problems.push(`寫入審核紀錄失敗：${error.message}`);
    }

    // --- 7. 正式事實 -------------------------------------------------------
    let promoted = 0;
    if (trust) {
      for (const fact of pack.knowledge_facts) {
        const candidateId = candidateIdByRef.get(fact.candidate_fact_id);
        if (!candidateId) continue;

        const { data: factId, error } = await supabase.rpc(
          "promote_candidate_fact",
          { p_candidate_id: candidateId },
        );

        if (error || !factId) {
          problems.push(
            `${fact.candidate_fact_id} 寫入正式事實失敗：${error?.message ?? "未知原因"}`,
          );
          continue;
        }

        promoted += 1;

        if (fact.tags && fact.tags.length > 0) {
          await supabase
            .from("knowledge_facts")
            .update({ tags: fact.tags })
            .eq("id", factId);
        }
      }
    }

    revalidatePath("/sources");
    revalidatePath("/review");
    revalidatePath("/knowledge");
    revalidatePath("/dashboard");

    return {
      status: "success",
      sourceId: createdSource.id,
      created: {
        chunks: createdChunks.length,
        candidates: createdCandidates.length,
        reviews: reviewRows.length,
        knowledgeFacts: promoted,
      },
      problems,
      message: trust
        ? `已匯入《${source.title}》：${createdChunks.length} 段原文、${createdCandidates.length} 筆候選事實、${promoted} 筆正式事實。`
        : `已匯入《${source.title}》：${createdChunks.length} 段原文、${createdCandidates.length} 筆候選事實，全部為待審核狀態，請到候選事實頁逐筆核定。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "匯入失敗",
    };
  }
}
