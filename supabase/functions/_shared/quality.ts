import { hasAnyCondition, type RawFact } from "./extraction.ts";

/**
 * 候選事實的自動品質檢查（工作單第 8.3 節）。
 *
 * 分兩級：
 * - fatal：無來源片段或片段不在原文 → 直接拒絕，不得進入核定流程
 * - flag：其餘問題標記出來，交由人工在審核介面判斷
 */

export const QUALITY_FLAGS = {
  MISSING_QUOTE: "missing_quote",
  QUOTE_NOT_IN_SOURCE: "quote_not_in_source",
  NUMBER_MISMATCH: "number_mismatch",
  INCOMPLETE_SUBJECT: "incomplete_subject",
  MULTI_PROPOSITION: "multi_proposition",
  CONDITION_LOST: "condition_lost",
  CERTAINTY_ESCALATED: "certainty_escalated",
  INFERENCE_SUSPECTED: "inference_suspected",
  DUPLICATE: "duplicate",
  CONTRADICTION: "contradiction",
  LOW_CONFIDENCE: "low_confidence",
} as const;

export type QualityFlag = (typeof QUALITY_FLAGS)[keyof typeof QUALITY_FLAGS];

/** 這兩個標記代表事實不可進入核定流程。 */
export const FATAL_FLAGS: QualityFlag[] = [
  QUALITY_FLAGS.MISSING_QUOTE,
  QUALITY_FLAGS.QUOTE_NOT_IN_SOURCE,
];

const FLAG_PENALTY: Record<QualityFlag, number> = {
  missing_quote: 100,
  quote_not_in_source: 100,
  number_mismatch: 30,
  incomplete_subject: 20,
  multi_proposition: 20,
  condition_lost: 25,
  certainty_escalated: 30,
  inference_suspected: 15,
  duplicate: 10,
  contradiction: 20,
  low_confidence: 5,
};

/** 比對用正規化：去除空白與常見全形／半形標點差異。 */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".")
    .replace(/[；;]/g, ";")
    .replace(/[：:]/g, ":")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .replace(/[「」“”"']/g, "")
    .toLowerCase();
}

/** 抽出數字與其後綴單位，例如 3.5 mg、50%、2024 年。 */
export function extractNumbers(text: string): string[] {
  const matches = text.matchAll(
    /(\d+(?:[.,]\d+)?)\s*(%|‰|°C|℃|mg\/kg|mg\/L|µg\/L|ug\/L|ppm|ppb|mg|kg|g|ml|mL|L|年|月|日|小時|分鐘|倍|次|人|份|公尺|公分)?/gu,
  );

  return [...matches]
    .map((match) => {
      const value = match[1].replace(/,/g, "");
      const unit = (match[2] ?? "").replace("℃", "°C").replace("ug/L", "µg/L");
      return `${Number(value)}${unit}`;
    })
    .filter((entry) => entry.length > 0);
}

const HEDGE_PATTERN =
  /(可能|或許|也許|據推測|推測|研究顯示|部分研究|建議|尚未確定|不一定|有機會|恐|疑似|通常|多數情況)/;
const CERTAIN_PATTERN = /(一定|必然|絕對|必定|保證|永遠|完全不會|百分之百)/;
const INFERENCE_PATTERN = /(因此|所以|由此可見|可推論|顯示出|意味著|代表著)/;
const PRONOUN_START_PATTERN = /^(這|那|它|他|她|其|該|此|上述|前述|以上|以下)/;
const CONDITION_MARKERS = [
  /(若|如果|倘若|除非)/,
  /(每日|每天|每週|每月|每年|長期|短期|急性|慢性)/,
  /(孕婦|兒童|嬰幼兒|老年人|勞工|成人|患者|一般民眾)/,
  /(吸入|食入|皮膚接觸|眼睛接觸|口服|注射)/,
  /(在.{1,12}(情況|條件|環境)下)/,
];

export interface QualityContext {
  /** 該事實所屬段落的原文。 */
  paragraphText: string;
  /** 同一批次中先前已接受的事實，用於重複與矛盾偵測。 */
  previousStatements?: { statement: string; subject: string | null }[];
}

export interface QualityResult {
  flags: QualityFlag[];
  fatal: boolean;
  score: number;
}

/** 判斷 source_quote 是否真的出現在原文中（允許空白與標點形式差異）。 */
export function quoteExistsInParagraph(quote: string, paragraph: string): boolean {
  if (!quote.trim()) return false;
  const normalizedQuote = normalizeForCompare(quote);
  const normalizedParagraph = normalizeForCompare(paragraph);
  if (!normalizedQuote) return false;
  return normalizedParagraph.includes(normalizedQuote);
}

/** 一句一事：句末標點超過一個，或使用並列連接詞連接兩個完整命題。 */
export function isMultiProposition(statement: string): boolean {
  const sentenceEnds = (statement.match(/[。！？!?]/g) ?? []).length;
  if (sentenceEnds > 1) return true;

  const trailing = /[。！？!?]$/.test(statement.trim());
  const inner = statement.replace(/[。！？!?]$/, "");
  if (!trailing && sentenceEnds >= 1) return true;

  return (
    /(；|;)/.test(inner) ||
    /(，且|，並且|，同時也|，也會|，還會|，此外)/.test(inner)
  );
}

export function checkFactQuality(
  fact: RawFact,
  context: QualityContext,
): QualityResult {
  const flags: QualityFlag[] = [];
  const quote = fact.source_quote?.trim() ?? "";

  if (!quote) {
    flags.push(QUALITY_FLAGS.MISSING_QUOTE);
  } else if (!quoteExistsInParagraph(quote, context.paragraphText)) {
    flags.push(QUALITY_FLAGS.QUOTE_NOT_IN_SOURCE);
  }

  // 數字與單位一致性：敘述中的每個數值都必須在原文片段中出現。
  const statementNumbers = extractNumbers(fact.statement);
  const quoteNumbers = new Set(extractNumbers(quote));
  if (statementNumbers.some((value) => !quoteNumbers.has(value))) {
    flags.push(QUALITY_FLAGS.NUMBER_MISMATCH);
  }

  if (PRONOUN_START_PATTERN.test(fact.statement.trim())) {
    flags.push(QUALITY_FLAGS.INCOMPLETE_SUBJECT);
  }

  if (isMultiProposition(fact.statement)) {
    flags.push(QUALITY_FLAGS.MULTI_PROPOSITION);
  }

  // 條件遺失：原文片段帶有條件語，但敘述與 conditions 欄位都沒有保留。
  const quoteConditions = CONDITION_MARKERS.filter((pattern) =>
    pattern.test(quote),
  );
  if (quoteConditions.length > 0) {
    const keptInStatement = quoteConditions.some((pattern) =>
      pattern.test(fact.statement),
    );
    if (!keptInStatement && !hasAnyCondition(fact.conditions)) {
      flags.push(QUALITY_FLAGS.CONDITION_LOST);
    }
  }

  // 不確定性被改寫成確定語氣。
  const quoteHedged = HEDGE_PATTERN.test(quote);
  const statementHedged = HEDGE_PATTERN.test(fact.statement);
  if (
    (quoteHedged && !statementHedged) ||
    (!quoteHedged && CERTAIN_PATTERN.test(fact.statement))
  ) {
    flags.push(QUALITY_FLAGS.CERTAINTY_ESCALATED);
  }

  // 疑似推論：敘述有推論連接詞但原文沒有。
  if (INFERENCE_PATTERN.test(fact.statement) && !INFERENCE_PATTERN.test(quote)) {
    flags.push(QUALITY_FLAGS.INFERENCE_SUSPECTED);
  }

  if (fact.confidence > 0 && fact.confidence < 0.35) {
    flags.push(QUALITY_FLAGS.LOW_CONFIDENCE);
  }

  const previous = context.previousStatements ?? [];
  if (
    previous.some((item) => isDuplicateStatement(item.statement, fact.statement))
  ) {
    flags.push(QUALITY_FLAGS.DUPLICATE);
  }
  if (previous.some((item) => isContradiction(item.statement, fact.statement))) {
    flags.push(QUALITY_FLAGS.CONTRADICTION);
  }

  const fatal = flags.some((flag) => FATAL_FLAGS.includes(flag));
  const score = Math.max(
    0,
    flags.reduce((total, flag) => total - FLAG_PENALTY[flag], 100),
  );

  return { flags, fatal, score };
}

export function isDuplicateStatement(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

const NEGATION_PATTERN = /(不會|不可|不能|沒有|無|禁止|未)/;

/** 去掉否定詞後的「命題骨架」，用來判斷兩句是否在談同一件事。 */
function negationCore(text: string): string {
  // 只移除否定標記本身（不、未、無、沒、禁止），保留其餘字詞，
  // 這樣「會累積」與「不會累積」的骨架才會一致。
  return normalizeForCompare(text)
    .replace(/禁止/g, "")
    .replace(/[不未無沒]/g, "");
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

/** 兩句是否在談同一個主體：去掉否定詞後共同前綴夠長。 */
function talksAboutSameThing(coreA: string, coreB: string): boolean {
  if (coreA === coreB) return true;
  const shortest = Math.min(coreA.length, coreB.length);
  if (shortest < 4) return false;
  return commonPrefixLength(coreA, coreB) >= Math.ceil(shortest * 0.6);
}

/**
 * 粗略的矛盾偵測：兩句談同一件事，但一句否定一句肯定，或同一單位的數值不同。
 * 只做標記，最終判斷仍由人工審核。
 */
export function isContradiction(a: string, b: string): boolean {
  if (normalizeForCompare(a) === normalizeForCompare(b)) return false;

  const coreA = negationCore(a);
  const coreB = negationCore(b);
  if (!talksAboutSameThing(coreA, coreB)) return false;

  const negatedA = NEGATION_PATTERN.test(a);
  const negatedB = NEGATION_PATTERN.test(b);
  if (negatedA !== negatedB) return true;

  // 帶單位的數值不同（純數字太容易誤判，只看有單位的）。
  const withUnit = (value: string) => /[^\d.]/.test(value);
  const numbersA = extractNumbers(a).filter(withUnit);
  const numbersB = extractNumbers(b).filter(withUnit);
  const unitOf = (value: string) => value.replace(/^[\d.]+/, "");

  return numbersA.some((valueA) =>
    numbersB.some(
      (valueB) => unitOf(valueA) === unitOf(valueB) && valueA !== valueB,
    ),
  );
}
