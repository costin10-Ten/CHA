import { normalizeForCompare, quoteExistsInParagraph } from "./quality.ts";
import { coverage } from "./verification.ts";

/**
 * 把原子命題包裡的原子命題對應到「系統自己解析出來的原文段落」。
 *
 * 為什麼需要這個：原子命題包裡的段落編號是整理者自己編的，
 * 與解析器產生的 P-001… 不保證一致；引句也可能抓得不精準。
 * 與其要求整理者手工對齊，不如由系統用內容去找。
 *
 * 比對順序（先確定的、再推測的）：
 *   1. 引句直接出現在某一段 → 最可靠，引句照用
 *   2. 敘述與某一段的內容重疊度夠高 → 在該段內找出最貼近的句子當引句
 *   3. 原子命題包給的段落編號剛好存在，且內容重疊度不算太低 → 用它
 *   4. 都不成立 → 不對應，交由呼叫端跳過並回報
 *
 * 只有第 1 種算「引句已驗證」；其餘都會標記為需人工確認，
 * 因為引句是系統推測的，不是整理者指定的。
 */

export interface MatchParagraph {
  paragraphId: string;
  text: string;
}

export interface MatchInput {
  ref: string;
  statement: string;
  /** 原子命題包裡的引句，可能是佔位符或空白。 */
  quote?: string | null;
  /** 原子命題包裡的段落編號，只當作提示。 */
  paragraphIdHint?: string | null;
}

export type MatchMethod = "quote" | "statement" | "paragraph_id" | "none";

export interface MatchResult {
  ref: string;
  paragraphId: string | null;
  /** 對應到的引句。method 為 quote 時是原本的引句，其餘是系統定位出來的。 */
  quote: string | null;
  method: MatchMethod;
  /** 0–1，敘述與該段的內容重疊度。 */
  score: number;
  /** true 表示引句由系統推測，需人工確認。 */
  needsReview: boolean;
  /** 次佳段落的分數，用來判斷是不是難以區分。 */
  runnerUpScore: number;
}

/**
 * 內容重疊度低於這個值就不視為同一段。
 *
 * 用示範資料量過：忠實反映原文的敘述，與正解段落的重疊度都在 0.8 以上；
 * 被扭曲或超出原文的敘述最高只到 0.46。0.55 落在這段空白裡，
 * 也與 verification.ts 的 SUPPORT_THRESHOLD 一致——
 * 「足以支持一句話的重疊度」在兩處是同一個概念。
 */
export const MATCH_THRESHOLD = 0.55;

/** 有段落編號提示時可以放寬到這個值。 */
export const HINT_THRESHOLD = 0.2;

/** 最佳與次佳差距小於這個值時，標記為難以區分。 */
export const AMBIGUOUS_MARGIN = 0.03;

/** 以句號、驚嘆號、問號、分號切句，保留標點。 */
export function splitParagraphSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * 在段落中找出最貼近這句原子命題的原文片段。
 *
 * 回傳的一定是段落裡真實存在的連續文字——
 * 系統可以「找出」引句，但絕不「編寫」引句。
 */
export function locateQuote(statement: string, paragraph: string): string {
  const sentences = splitParagraphSentences(paragraph);
  if (sentences.length <= 1) return paragraph;

  const scored = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: coverage(sentence, statement),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return paragraph;

  // 相鄰且分數接近的句子一起帶出來，避免把跨句的原子命題切一半。
  const neighbours = scored.filter(
    (item) =>
      Math.abs(item.index - best.index) === 1 && item.score >= best.score * 0.8,
  );

  if (neighbours.length === 0) return best.sentence;

  const indexes = [best.index, ...neighbours.map((item) => item.index)].sort(
    (a, b) => a - b,
  );

  return sentences.slice(indexes[0], indexes[indexes.length - 1] + 1).join("");
}

function normalizeHint(hint: string | null | undefined): string | null {
  const value = (hint ?? "").trim();
  if (!value) return null;

  const digits = /(\d+)/.exec(value);
  if (/^P-\d+$/i.test(value)) return value.toUpperCase();
  return digits ? `P-${digits[1].padStart(3, "0")}` : value;
}

/** 判斷引句是否可用：非空、非佔位符。 */
function usableQuote(quote: string | null | undefined): string | null {
  const value = (quote ?? "").trim();
  if (!value) return null;
  if (/^\$|^<[^>]*>$|^（?待填|^TODO/i.test(value)) return null;
  return value;
}

export function matchFact(
  fact: MatchInput,
  paragraphs: MatchParagraph[],
): MatchResult {
  const base: MatchResult = {
    ref: fact.ref,
    paragraphId: null,
    quote: null,
    method: "none",
    score: 0,
    needsReview: true,
    runnerUpScore: 0,
  };

  if (paragraphs.length === 0) return base;

  const scored = paragraphs
    .map((paragraph) => ({
      paragraph,
      score: coverage(fact.statement, paragraph.text),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1]?.score ?? 0;

  // 1. 引句直接出現在某一段：最可靠。
  const quote = usableQuote(fact.quote);
  if (quote) {
    const containing = paragraphs.filter((paragraph) =>
      quoteExistsInParagraph(quote, paragraph.text),
    );

    if (containing.length > 0) {
      const hint = normalizeHint(fact.paragraphIdHint);
      const chosen =
        containing.find((paragraph) => paragraph.paragraphId === hint) ??
        containing
          .map((paragraph) => ({
            paragraph,
            score: coverage(fact.statement, paragraph.text),
          }))
          .sort((a, b) => b.score - a.score)[0].paragraph;

      return {
        ref: fact.ref,
        paragraphId: chosen.paragraphId,
        quote,
        method: "quote",
        score: coverage(fact.statement, chosen.text),
        needsReview: false,
        runnerUpScore: runnerUp,
      };
    }
  }

  // 2. 以敘述內容比對。
  if (best && best.score >= MATCH_THRESHOLD) {
    return {
      ref: fact.ref,
      paragraphId: best.paragraph.paragraphId,
      quote: locateQuote(fact.statement, best.paragraph.text),
      method: "statement",
      score: best.score,
      needsReview: true,
      runnerUpScore: runnerUp,
    };
  }

  // 3. 段落編號提示：內容不能完全對不上，才接受。
  const hint = normalizeHint(fact.paragraphIdHint);
  if (hint) {
    const hinted = paragraphs.find((paragraph) => paragraph.paragraphId === hint);

    if (hinted) {
      const score = coverage(fact.statement, hinted.text);
      if (score >= HINT_THRESHOLD) {
        return {
          ref: fact.ref,
          paragraphId: hinted.paragraphId,
          quote: locateQuote(fact.statement, hinted.text),
          method: "paragraph_id",
          score,
          needsReview: true,
          runnerUpScore: runnerUp,
        };
      }
    }
  }

  return { ...base, score: best?.score ?? 0, runnerUpScore: runnerUp };
}

export interface MatchSummary {
  byQuote: number;
  byStatement: number;
  byParagraphId: number;
  unmatched: number;
  ambiguous: number;
}

export function matchFacts(
  facts: MatchInput[],
  paragraphs: MatchParagraph[],
): { results: MatchResult[]; summary: MatchSummary } {
  const results = facts.map((fact) => matchFact(fact, paragraphs));

  return {
    results,
    summary: {
      byQuote: results.filter((item) => item.method === "quote").length,
      byStatement: results.filter((item) => item.method === "statement").length,
      byParagraphId: results.filter((item) => item.method === "paragraph_id")
        .length,
      unmatched: results.filter((item) => item.method === "none").length,
      ambiguous: results.filter(
        (item) =>
          item.method !== "none" &&
          item.method !== "quote" &&
          item.score - item.runnerUpScore < AMBIGUOUS_MARGIN,
      ).length,
    },
  };
}

/** 供介面顯示。 */
export const MATCH_METHOD_LABEL: Record<MatchMethod, string> = {
  quote: "引句直接命中原文",
  statement: "以敘述內容比對出段落",
  paragraph_id: "依段落編號對應",
  none: "找不到對應段落",
};

export { normalizeForCompare };
