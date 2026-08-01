"use server";

import { revalidatePath } from "next/cache";

import {
  validateArticlePack,
  type NormalizedArticle,
  type PackIssue,
  type PackSummary,
} from "@shared/article-pack.ts";
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
 * 匯入文章包。
 *
 * 寬進嚴審：
 * - 能自動補的欄位都補（驗證階段完成），補不了的只跳過那一筆
 * - 引句對不上原文的事實會退回「以整段為依據」並強制待審核，不會被核定
 * - 正式事實一律由候選事實經 promote_candidate_fact 產生，不直接插入
 * - 預設不信任檔案裡的審核狀態；要沿用人工核定結果必須明確勾選
 */

export interface ValidateResult {
  ok: boolean;
  issues: PackIssue[];
  summary: PackSummary;
  titles: string[];
  humanReview: string | null;
}

const EMPTY_SUMMARY: PackSummary = {
  articles: 0,
  chunks: 0,
  candidates: 0,
  approved: 0,
  rejected: 0,
  needsFix: 0,
  knowledgeFacts: 0,
  reviews: 0,
  quoteFallbacks: 0,
  skipped: 0,
};

function parseJson(json: string): { value: unknown } | { error: string } {
  if (!json.trim()) return { error: "請貼上或上傳文章包 JSON" };
  try {
    return { value: JSON.parse(json) };
  } catch {
    return { error: "不是合法的 JSON，請確認檔案完整" };
  }
}

export async function validatePack(json: string): Promise<ValidateResult> {
  const parsed = parseJson(json);
  if ("error" in parsed) {
    return {
      ok: false,
      issues: [{ level: "error", where: "檔案", message: parsed.error }],
      summary: EMPTY_SUMMARY,
      titles: [],
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
    titles: result.articles.map((article) => article.source.title),
    humanReview: typeof meta?.human_review === "string" ? meta.human_review : null,
  };
}

export type ImportPackResult =
  | { status: "idle" }
  | { status: "error"; message: string; issues?: PackIssue[] }
  | {
      status: "success";
      message: string;
      sourceIds: string[];
      created: {
        articles: number;
        chunks: number;
        candidates: number;
        reviews: number;
        knowledgeFacts: number;
      };
      problems: string[];
    };

/** 條件欄位固定六個鍵，缺的補 null，與抽取管線輸出一致。 */
function normalizeConditions(input: Record<string, string | null>): FactConditions {
  return {
    population: input.population ?? null,
    exposure_route: input.exposure_route ?? null,
    dose: input.dose ?? null,
    duration: input.duration ?? null,
    location: input.location ?? null,
    timeframe: input.timeframe ?? null,
  };
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
    if (!validation.ok) {
      return {
        status: "error",
        message: "檔案裡沒有任何可匯入的事實，沒有寫入任何資料。",
        issues: validation.issues,
      };
    }

    // 驗證階段的提醒一併回報，讓使用者知道系統自動補了什麼。
    const problems = validation.issues.map(
      (issue) =>
        `${issue.level === "error" ? "已跳過" : "已自動處理"}｜${issue.where}：${issue.message}`,
    );

    const created = {
      articles: 0,
      chunks: 0,
      candidates: 0,
      reviews: 0,
      knowledgeFacts: 0,
    };
    const sourceIds: string[] = [];

    for (const article of validation.articles) {
      const outcome = await importOne(article, user.id, options, problems);
      if (!outcome) continue;

      sourceIds.push(outcome.sourceId);
      created.articles += 1;
      created.chunks += outcome.chunks;
      created.candidates += outcome.candidates;
      created.reviews += outcome.reviews;
      created.knowledgeFacts += outcome.knowledgeFacts;
    }

    if (created.articles === 0) {
      return {
        status: "error",
        message: "沒有任何一篇匯入成功。",
        issues: validation.issues,
      };
    }

    revalidatePath("/sources");
    revalidatePath("/review");
    revalidatePath("/knowledge");
    revalidatePath("/dashboard");

    const fallbackNote =
      validation.summary.quoteFallbacks > 0
        ? `其中 ${validation.summary.quoteFallbacks} 筆因為引句對不上原文，已改以整段為依據並設為待審核。`
        : "";

    return {
      status: "success",
      sourceIds,
      created,
      problems,
      message: options.trustHumanReview
        ? `已匯入 ${created.articles} 篇：${created.chunks} 段原文、${created.candidates} 筆候選事實、${created.knowledgeFacts} 筆正式事實。${fallbackNote}`
        : `已匯入 ${created.articles} 篇：${created.chunks} 段原文、${created.candidates} 筆候選事實，全部為待審核，請到候選事實頁逐筆核定。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "匯入失敗",
    };
  }
}

interface ImportOutcome {
  sourceId: string;
  chunks: number;
  candidates: number;
  reviews: number;
  knowledgeFacts: number;
}

async function importOne(
  article: NormalizedArticle,
  ownerId: string,
  options: { trustHumanReview?: boolean },
  problems: string[],
): Promise<ImportOutcome | null> {
  const supabase = await createClient();
  const { source, version } = article;

  // 同一個網址已經匯入過就跳過這一篇，避免無聲產生重複的知識。
  if (source.origin_url) {
    const { data: existing } = await supabase
      .from("sources")
      .select("id, title")
      .eq("origin_url", source.origin_url)
      .maybeSingle();

    if (existing) {
      problems.push(
        `已跳過｜${source.title}：這個網址已經匯入過（${existing.title}）。要更新內容請到來源頁重新解析。`,
      );
      return null;
    }
  }

  const fullText = article.chunks.map((chunk) => chunk.text).join("\n\n");
  const sourceHash = source.content_hash ?? (await contentHash(fullText));

  const { data: createdSource, error: sourceError } = await supabase
    .from("sources")
    .insert({
      owner_id: ownerId,
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
    problems.push(
      `已跳過｜${source.title}：建立來源失敗（${sourceError?.message}）`,
    );
    return null;
  }

  const { data: createdVersion, error: versionError } = await supabase
    .from("source_versions")
    .insert({
      owner_id: ownerId,
      source_id: createdSource.id,
      version: 1,
      title: version.title,
      raw_text: version.raw_text ?? fullText,
      content_hash: sourceHash,
      parser_version: version.parser_version,
      char_count: version.char_count || fullText.length,
      chunk_count: article.chunks.length,
      is_current: true,
      fetched_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (versionError || !createdVersion) {
    problems.push(
      `已跳過｜${source.title}：建立來源版本失敗（${versionError?.message}）`,
    );
    return null;
  }

  // char_start／char_end 若檔案沒給就依段落順序推算，前後文才有意義。
  let offset = 0;
  const chunkRows = await Promise.all(
    article.chunks.map(async (chunk, index) => {
      const start = chunk.char_start || offset;
      const end = chunk.char_end || start + chunk.text.length;
      offset = end + 2;

      return {
        owner_id: ownerId,
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
    problems.push(
      `已跳過｜${source.title}：建立段落失敗（${chunkError?.message}）`,
    );
    return null;
  }

  const chunkIdByParagraph = new Map(
    createdChunks.map((chunk) => [chunk.paragraph_id, chunk.id]),
  );

  for (const job of article.jobs) {
    await supabase.from("processing_jobs").insert({
      owner_id: ownerId,
      job_type: "extract_facts",
      source_id: createdSource.id,
      status: "completed",
      progress: 100,
      payload: (job.payload ?? {}) as Json,
      result: (job.result ?? {}) as Json,
      finished_at: new Date().toISOString(),
    });
  }

  const trust = options.trustHumanReview === true;

  const candidateRows = await Promise.all(
    article.candidates.map(async (candidate) => ({
      owner_id: ownerId,
      source_id: createdSource.id,
      source_version_id: createdVersion.id,
      document_chunk_id:
        chunkIdByParagraph.get(candidate.source_paragraph_id) ?? null,
      statement: candidate.statement,
      subject: candidate.subject,
      predicate: candidate.predicate,
      object: candidate.object,
      knowledge_type: candidate.knowledge_type as KnowledgeType,
      conditions: normalizeConditions(candidate.conditions),
      source_quote: candidate.source_quote,
      source_paragraph_id: candidate.source_paragraph_id,
      risk_level: candidate.risk_level as RiskLevel,
      confidence: candidate.confidence,
      // 不信任檔案審核結果時一律以待審核進入系統。
      status: (trust ? candidate.status : "pending") as CandidateStatus,
      quality_flags: candidate.quality_flags,
      quality_score: candidate.quality_score,
      // 雜湊一律重算，才能和系統其他路徑用同一套規則去重。
      statement_hash: await sha256Hex(normalizeForCompare(candidate.statement)),
      extraction_batch: candidate.extraction_batch,
      review_note: candidate.review_note,
      edited: candidate.edited,
      original_statement: candidate.original_statement,
      reviewed_at:
        trust && candidate.status !== "pending" ? new Date().toISOString() : null,
    })),
  );

  const { data: createdCandidates, error: candidateError } = await supabase
    .from("candidate_facts")
    .insert(candidateRows)
    .select("id");

  if (candidateError || !createdCandidates) {
    problems.push(
      `已跳過｜${source.title}：建立候選事實失敗（${candidateError?.message}）`,
    );
    return null;
  }

  const candidateIdByRef = new Map<string, string>();
  article.candidates.forEach((candidate, index) => {
    const created = createdCandidates[index];
    if (created) candidateIdByRef.set(candidate.ref, created.id);
  });

  const reviewRows = article.reviews
    .map((review) => {
      const candidateId = candidateIdByRef.get(review.candidate_fact_id);
      if (!candidateId) return null;

      return {
        owner_id: ownerId,
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
    if (error) {
      problems.push(`${source.title}：寫入審核紀錄失敗（${error.message}）`);
    }
  }

  let promoted = 0;
  if (trust) {
    for (const fact of article.knowledgeFacts) {
      const candidateId = candidateIdByRef.get(fact.candidate_fact_id);
      if (!candidateId) continue;

      const { data: factId, error } = await supabase.rpc("promote_candidate_fact", {
        p_candidate_id: candidateId,
      });

      if (error || !factId) {
        problems.push(
          `${source.title}／${fact.candidate_fact_id}：寫入正式事實失敗（${error?.message ?? "未知原因"}）`,
        );
        continue;
      }

      promoted += 1;

      if (fact.tags.length > 0) {
        await supabase
          .from("knowledge_facts")
          .update({ tags: fact.tags })
          .eq("id", factId);
      }
    }
  }

  return {
    sourceId: createdSource.id,
    chunks: createdChunks.length,
    candidates: createdCandidates.length,
    reviews: reviewRows.length,
    knowledgeFacts: promoted,
  };
}
