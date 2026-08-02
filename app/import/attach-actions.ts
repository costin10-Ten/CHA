"use server";

import { revalidatePath } from "next/cache";

import { validateArticlePack, type PackCandidate } from "@shared/article-pack.ts";
import type { FactConditions } from "@shared/extraction.ts";
import { sha256Hex } from "@shared/hash.ts";
import {
  MATCH_METHOD_LABEL,
  matchFacts,
  type MatchSummary,
} from "@shared/fact-matching.ts";
import { normalizeForCompare } from "@shared/quality.ts";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type {
  CandidateStatus,
  Json,
  PropositionType,
  ReviewActionType,
  RiskLevel,
} from "@/lib/supabase/types";

/**
 * 把原子命題包附加到「已經由系統解析過的來源」。
 *
 * 這條路徑讓原子命題包不必自帶原文：原文用一般的匯入流程（文字／檔案／網址）
 * 進系統並解析成段落，原子命題包只要有敘述，系統就能用內容比對找出對應段落。
 *
 * 三種對應方式的可信度不同，處理也不同：
 * - 引句直接命中原文 → 引句照用，可沿用檔案中的核定狀態
 * - 以敘述或段落編號比對出來 → 引句是系統定位的，一律回到待審核
 */

export type AttachResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      matched: MatchSummary;
      created: { candidates: number; reviews: number; knowledgeFacts: number };
      problems: string[];
    };

export interface SourceOption {
  id: string;
  title: string;
  chunkCount: number;
  status: string;
}

/** 已經解析完成、可以附加原子命題包的來源。 */
export async function listAttachableSources(): Promise<SourceOption[]> {
  const supabase = await createClient();

  const { data: sources } = await supabase
    .from("sources")
    .select("id, title, status")
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(100);

  if (!sources || sources.length === 0) return [];

  const { data: versions } = await supabase
    .from("source_versions")
    .select("id, source_id, chunk_count")
    .eq("is_current", true)
    .in(
      "source_id",
      sources.map((source) => source.id),
    );

  const chunkCountBySource = new Map(
    (versions ?? []).map((version) => [version.source_id, version.chunk_count]),
  );

  return sources.map((source) => ({
    id: source.id,
    title: source.title,
    status: source.status,
    chunkCount: chunkCountBySource.get(source.id) ?? 0,
  }));
}

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

export async function attachFactPack(
  sourceId: string,
  json: string,
  options: { trustHumanReview?: boolean } = {},
): Promise<AttachResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    if (!json.trim()) return { status: "error", message: "請提供原子命題包 JSON" };

    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      return { status: "error", message: "原子命題包不是合法的 JSON" };
    }

    const supabase = await createClient();

    // 1. 取回這份來源的現行段落。
    const { data: version } = await supabase
      .from("source_versions")
      .select("id")
      .eq("source_id", sourceId)
      .eq("is_current", true)
      .maybeSingle();

    if (!version) {
      return {
        status: "error",
        message: "這份來源還沒有解析完成的版本，請等解析完成後再附加原子命題包。",
      };
    }

    const { data: chunks } = await supabase
      .from("document_chunks")
      .select("id, paragraph_id, text")
      .eq("source_version_id", version.id)
      .order("position", { ascending: true });

    if (!chunks || chunks.length === 0) {
      return { status: "error", message: "這份來源沒有任何段落，無法比對。" };
    }

    // 2. 解析原子命題包。這裡不要求它自帶原文，段落由來源提供。
    const validation = validateArticlePack(payload);
    const packCandidates: PackCandidate[] = validation.articles.flatMap(
      (article) => article.candidates,
    );

    // 原子命題包完全沒有原文時，validateArticlePack 會把原子命題全部跳過；
    // 這條路徑本來就不需要它自帶原文，因此改用寬鬆解析取回敘述。
    const facts =
      packCandidates.length > 0
        ? packCandidates.map((candidate) => ({
            ref: candidate.ref,
            statement: candidate.statement,
            quote: candidate.quote_fallback ? null : candidate.source_quote,
            paragraphIdHint: candidate.source_paragraph_id,
            candidate,
          }))
        : readFactsLoosely(payload);

    if (facts.length === 0) {
      return { status: "error", message: "原子命題包裡沒有任何原子命題敘述。" };
    }

    // 3. 比對。
    const paragraphs = chunks.map((chunk) => ({
      paragraphId: chunk.paragraph_id,
      text: chunk.text,
    }));

    const { results, summary } = matchFacts(facts, paragraphs);
    const chunkByParagraph = new Map(
      chunks.map((chunk) => [chunk.paragraph_id, chunk]),
    );

    const problems: string[] = [];
    const trust = options.trustHumanReview === true;

    const rows = [];
    const refOrder: string[] = [];

    for (const [index, match] of results.entries()) {
      const fact = facts[index];

      if (!match.paragraphId || !match.quote) {
        problems.push(
          `已跳過｜${fact.ref}：找不到對應段落（最高重疊度 ${match.score.toFixed(2)}）。這句可能不屬於這份原文。`,
        );
        continue;
      }

      const chunk = chunkByParagraph.get(match.paragraphId);
      if (!chunk) continue;

      const source = fact.candidate;
      const flags = [...(source?.quality_flags ?? [])];
      if (match.needsReview) flags.push("quote_auto_located");

      const note = [
        source?.review_note,
        `比對方式：${MATCH_METHOD_LABEL[match.method]}（重疊度 ${match.score.toFixed(2)}）`,
      ]
        .filter(Boolean)
        .join("｜");

      refOrder.push(fact.ref);
      rows.push({
        owner_id: user.id,
        source_id: sourceId,
        source_version_id: version.id,
        document_chunk_id: chunk.id,
        statement: fact.statement,
        subject: source?.subject ?? null,
        predicate: source?.predicate ?? null,
        object: source?.object ?? null,
        proposition_types: (source?.proposition_types ?? []) as PropositionType[],
        conditions: normalizeConditions(source?.conditions ?? {}),
        source_quote: match.quote,
        source_paragraph_id: match.paragraphId,
        risk_level: (source?.risk_level ?? "medium") as RiskLevel,
        confidence: match.score,
        // 引句是系統定位出來的就一律回到待審核，不沿用檔案裡的核定。
        status: (match.needsReview || !trust
          ? "pending"
          : (source?.status ?? "pending")) as CandidateStatus,
        quality_flags: flags,
        quality_score: match.needsReview ? 60 : (source?.quality_score ?? 100),
        statement_hash: await sha256Hex(normalizeForCompare(fact.statement)),
        review_note: note || null,
        edited: source?.edited ?? false,
        original_statement: source?.original_statement ?? null,
        extraction_batch: source?.extraction_batch ?? "fact-pack-attach",
        reviewed_at:
          !match.needsReview &&
          trust &&
          source?.status &&
          source.status !== "pending"
            ? new Date().toISOString()
            : null,
      });
    }

    if (rows.length === 0) {
      return {
        status: "error",
        message:
          "沒有任何一筆原子命題對應得到這份原文的段落。請確認原子命題包與原文是同一篇文章。",
      };
    }

    const { data: created, error } = await supabase
      .from("candidate_facts")
      .insert(rows)
      .select("id");

    if (error || !created) {
      throw new Error(`寫入候選原子命題失敗：${error?.message}`);
    }

    const idByRef = new Map<string, string>();
    refOrder.forEach((ref, index) => {
      const row = created[index];
      if (row) idByRef.set(ref, row.id);
    });

    // 4. 審核紀錄與正式原子命題：只有引句直接命中的才可能沿用核定結果。
    let reviews = 0;
    let promoted = 0;

    for (const article of validation.articles) {
      for (const review of article.reviews) {
        const candidateId = idByRef.get(review.candidate_fact_id);
        if (!candidateId) continue;

        const { error: reviewError } = await supabase
          .from("review_records")
          .insert({
            owner_id: user.id,
            candidate_fact_id: candidateId,
            source_id: sourceId,
            action: review.action as ReviewActionType,
            from_status: (review.from_status ?? null) as CandidateStatus | null,
            to_status: (review.to_status ?? null) as CandidateStatus | null,
            note: review.note,
            changes: (review.changes ?? {}) as Json,
            related_ids: [],
          });

        if (!reviewError) reviews += 1;
      }

      if (!trust) continue;

      for (const fact of article.knowledgeFacts) {
        const candidateId = idByRef.get(fact.candidate_fact_id);
        if (!candidateId) continue;

        const { data: factId, error: promoteError } = await supabase.rpc(
          "promote_candidate_fact",
          { p_candidate_id: candidateId },
        );

        if (promoteError || !factId) {
          problems.push(
            `${fact.candidate_fact_id}：尚未寫入正式原子命題（${promoteError?.message ?? "引句由系統定位，需先人工核定"}）`,
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

    revalidatePath("/review");
    revalidatePath("/knowledge");
    revalidatePath("/dashboard");
    revalidatePath(`/sources/${sourceId}`);

    const needsReviewCount = summary.byStatement + summary.byParagraphId;

    return {
      status: "success",
      matched: summary,
      created: { candidates: created.length, reviews, knowledgeFacts: promoted },
      problems,
      message:
        `已附加 ${created.length} 筆原子命題：引句直接命中 ${summary.byQuote} 筆、` +
        `系統比對出段落 ${needsReviewCount} 筆（已設為待審核）、` +
        `找不到對應 ${summary.unmatched} 筆。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "附加原子命題包失敗",
    };
  }
}

/**
 * 原子命題包完全沒有附原文時的寬鬆讀取：只取敘述、引句與段落編號。
 * 其餘欄位交給人工在審核時補，不在這裡臆測。
 */
function readFactsLoosely(payload: unknown): {
  ref: string;
  statement: string;
  quote: string | null;
  paragraphIdHint: string | null;
  candidate: PackCandidate | undefined;
}[] {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const articles = Array.isArray(root.articles) ? root.articles : [root];
  const out: {
    ref: string;
    statement: string;
    quote: string | null;
    paragraphIdHint: string | null;
    candidate: undefined;
  }[] = [];

  for (const item of articles) {
    const article =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};

    const list = [
      "facts",
      "candidate_facts",
      "candidates",
      "原子命題",
      "命題",
      "事實",
    ]
      .map((key) => article[key])
      .find((value) => Array.isArray(value));

    for (const [index, raw] of (Array.isArray(list) ? list : []).entries()) {
      const row =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

      const statement = [
        "statement",
        "fact",
        "sentence",
        "text",
        "敘述",
        "原子命題",
        "命題",
        "事實",
      ]
        .map((key) => row[key])
        .find((value) => typeof value === "string" && value.trim().length > 1);

      if (typeof statement !== "string") continue;

      const quote = ["source_quote", "quote", "evidence", "原文片段"]
        .map((key) => row[key])
        .find((value) => typeof value === "string" && value.trim());

      const hint = ["source_paragraph_id", "paragraph_id", "paragraph", "段落"]
        .map((key) => row[key])
        .find((value) => typeof value === "string" && value.trim());

      const ref = ["ref", "id", "編號"]
        .map((key) => row[key])
        .find((value) => typeof value === "string" && value.trim());

      out.push({
        ref:
          typeof ref === "string" ? ref : `C${String(index + 1).padStart(3, "0")}`,
        statement: statement.trim(),
        quote: typeof quote === "string" ? quote : null,
        paragraphIdHint: typeof hint === "string" ? hint : null,
        candidate: undefined,
      });
    }
  }

  return out;
}
