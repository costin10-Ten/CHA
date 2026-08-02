import {
  declaresInsufficient,
  extractCitations,
  type EvidencePack,
} from "./answering.ts";
import { extractNumbers, normalizeForCompare } from "./quality.ts";

/**
 * 回答逐句驗證（工作單第 14 節）。
 *
 * 刻意做成確定性規則而非再呼叫一次模型：
 * - 可完整單元測試，結果可重現
 * - 不會因為模型當天心情不同而放行不該放行的句子
 * - 不需要額外的 API 花費
 *
 * 判定：
 *   supported   綠：有核定原子命題直接支持，數字、否定與條件都一致
 *   partial     黃：部分支持或需確認（語氣被放大、條件遺失、相似度不足）
 *   unsupported 紅：找不到支持的原子命題，或與原子命題矛盾 → 不得進入最終發布稿
 */

export type Verdict = "supported" | "partial" | "unsupported";

export const SUPPORT_THRESHOLD = 0.55;
export const PARTIAL_THRESHOLD = 0.25;

export interface VerificationFact {
  knowledgeId: string;
  factId: string;
  statement: string;
  conditions: Record<string, string | null>;
}

export interface SentenceVerification {
  sentence: string;
  verdict: Verdict;
  supportingRefs: string[];
  supportingFactIds: string[];
  similarity: number;
  reasons: string[];
}

export interface VerificationSummary {
  supported: number;
  partial: number;
  unsupported: number;
  /** 沒有任何紅色句子才可發布。 */
  publishable: boolean;
}

const HEDGE_PATTERN =
  /(可能|或許|也許|據推測|推測|研究顯示|部分研究|建議|尚未確定|不一定|有機會|疑似|通常)/;
const NEGATION_PATTERN = /(不會|不可|不能|沒有|無法|無|禁止|未|非)/;
const CONDITION_HINTS =
  /(孕婦|兒童|嬰幼兒|老年人|勞工|成人|患者|每日|每天|每週|每月|每年|長期|短期|急性|慢性|吸入|食入|皮膚接觸|眼睛接觸|口服)/g;

/** 取出句子或原子命題中出現的具體條件詞。 */
function conditionTokens(text: string): string[] {
  return [...new Set(text.match(CONDITION_HINTS) ?? [])];
}

/** 去掉引用標記，只留下要驗證的內容。 */
export function stripCitations(sentence: string): string {
  return sentence.replace(/\[K-\d{4}\]/g, "").trim();
}

function bigrams(text: string): Set<string> {
  const normalized = normalizeForCompare(text);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  if (result.size === 0 && normalized.length > 0) result.add(normalized);
  return result;
}

/**
 * 以字元 bigram 的覆蓋率衡量「這句話有多少內容來自該原子命題」。
 * 分母用句子本身，因此原子命題比句子長不會被稀釋。
 */
export function coverage(sentence: string, factStatement: string): number {
  const sentenceGrams = bigrams(sentence);
  if (sentenceGrams.size === 0) return 0;

  const factGrams = bigrams(factStatement);
  let hits = 0;
  for (const gram of sentenceGrams) {
    if (factGrams.has(gram)) hits += 1;
  }
  return hits / sentenceGrams.size;
}

/** 驗證單一句子。 */
export function verifySentence(
  sentence: string,
  facts: VerificationFact[],
): SentenceVerification {
  const clean = stripCitations(sentence);
  const citations = extractCitations(sentence);
  const reasons: string[] = [];

  // 「資料不足」屬於系統說明，不是原子命題主張。
  if (declaresInsufficient(clean)) {
    return {
      sentence,
      verdict: "supported",
      supportingRefs: [],
      supportingFactIds: [],
      similarity: 1,
      reasons: ["資料不足的說明，不是原子命題陳述"],
    };
  }

  if (facts.length === 0) {
    return {
      sentence,
      verdict: "unsupported",
      supportingRefs: [],
      supportingFactIds: [],
      similarity: 0,
      reasons: ["證據包中沒有任何核定原子命題"],
    };
  }

  const cited = facts.filter((fact) => citations.includes(fact.knowledgeId));
  const unknownCitations = citations.filter(
    (ref) => !facts.some((fact) => fact.knowledgeId === ref),
  );
  if (unknownCitations.length > 0) {
    reasons.push(`引用了證據包以外的編號：${unknownCitations.join("、")}`);
  }

  // 有引用就以引用的原子命題為準，沒有引用才全部比對。
  const pool = cited.length > 0 ? cited : facts;
  const scored = pool
    .map((fact) => ({ fact, score: coverage(clean, fact.statement) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const supporting = scored.filter((item) => item.score >= PARTIAL_THRESHOLD);

  // 數字與單位必須在支持的原子命題中出現。
  const sentenceNumbers = extractNumbers(clean);
  const factNumbers = new Set(
    supporting.flatMap((item) => extractNumbers(item.fact.statement)),
  );
  const missingNumbers = sentenceNumbers.filter((value) => !factNumbers.has(value));
  if (missingNumbers.length > 0) {
    reasons.push(`數字或單位在核定原子命題中找不到：${missingNumbers.join("、")}`);
  }

  // 否定與肯定不一致視為矛盾。
  const negatedSentence = NEGATION_PATTERN.test(clean);
  const negatedFact = best ? NEGATION_PATTERN.test(best.fact.statement) : false;
  const negationMismatch =
    best !== undefined &&
    best.score >= PARTIAL_THRESHOLD &&
    negatedSentence !== negatedFact;
  if (negationMismatch) {
    reasons.push("否定語氣與核定原子命題不一致");
  }

  // 原子命題有不確定語氣但句子改成肯定。
  const factHedged = supporting.some((item) =>
    HEDGE_PATTERN.test(item.fact.statement),
  );
  const sentenceHedged = HEDGE_PATTERN.test(clean);
  if (factHedged && !sentenceHedged) {
    reasons.push("核定原子命題帶有不確定語氣，回答卻寫成確定語氣");
  }

  // 原子命題帶條件但句子沒有帶出「同一個」條件。
  // 只檢查「有沒有條件詞」會誤放：原子命題寫「孕婦」、句子寫「每週」也會被當成有保留。
  const sentenceConditions = new Set(conditionTokens(clean));
  const missingConditions = [
    ...new Set(
      supporting.flatMap((item) => [
        ...conditionTokens(item.fact.statement),
        ...Object.values(item.fact.conditions ?? {})
          .filter((value): value is string => Boolean(value))
          .flatMap((value) => conditionTokens(value)),
      ]),
    ),
  ].filter((token) => !sentenceConditions.has(token));

  if (missingConditions.length > 0) {
    reasons.push(`核定原子命題的適用條件未保留：${missingConditions.join("、")}`);
  }

  const similarity = best?.score ?? 0;

  let verdict: Verdict;
  if (
    similarity < PARTIAL_THRESHOLD ||
    missingNumbers.length > 0 ||
    negationMismatch ||
    unknownCitations.length > 0
  ) {
    verdict = "unsupported";
  } else if (similarity >= SUPPORT_THRESHOLD && reasons.length === 0) {
    verdict = "supported";
  } else {
    verdict = "partial";
  }

  if (verdict === "unsupported" && reasons.length === 0) {
    reasons.push("找不到足以支持這句話的核定原子命題");
  }

  return {
    sentence,
    verdict,
    supportingRefs: supporting.map((item) => item.fact.knowledgeId),
    supportingFactIds: supporting.map((item) => item.fact.factId),
    similarity,
    reasons,
  };
}

export function verifyAnswerSentences(
  sentences: string[],
  facts: VerificationFact[],
): SentenceVerification[] {
  return sentences.map((sentence) => verifySentence(sentence, facts));
}

export function summarize(results: SentenceVerification[]): VerificationSummary {
  const summary = {
    supported: results.filter((item) => item.verdict === "supported").length,
    partial: results.filter((item) => item.verdict === "partial").length,
    unsupported: results.filter((item) => item.verdict === "unsupported").length,
    publishable: false,
  };
  summary.publishable =
    summary.unsupported === 0 && summary.supported + summary.partial > 0;
  return summary;
}

/**
 * 最終發布稿：移除所有紅色句子（工作單第 14 節第 6 點）。
 * 黃色句子保留，但呼叫端應提醒使用者確認。
 */
export function buildPublishableAnswer(results: SentenceVerification[]): string {
  return results
    .filter((item) => item.verdict !== "unsupported")
    .map((item) => item.sentence)
    .join("\n");
}

/** 由證據包轉成驗證用的原子命題清單。 */
export function factsFromPack(
  pack: EvidencePack,
  factIds: Record<string, string>,
): VerificationFact[] {
  return pack.facts.map((fact) => ({
    knowledgeId: fact.knowledge_id,
    factId: factIds[fact.knowledge_id] ?? fact.knowledge_id,
    statement: fact.statement,
    conditions: fact.conditions,
  }));
}
