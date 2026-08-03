import { quoteExistsInParagraph } from "./quality.ts";

/**
 * 文章包：在對話或其他工具中整理好的文章，連同段落、候選原子命題、
 * 審核紀錄與正式原子命題一次匯入。
 *
 * 設計原則是「寬進嚴審」：
 * - 能自動補的就自動補（欄位別名、列舉值、段落編號、字元位置）
 * - 補不了的只跳過那一筆，其餘照常匯入，不會整包擋下
 * - 唯一不放寬的是可回溯性：每一筆原子命題都要有真正的原文可對照
 *
 * 引句對不上原文時不再擋下，而是退回「以整段原文為依據」並強制回到待審核。
 * 這樣既不會因為引句抓得不精準就匯不進來，也不會讓對不上的引句被當成已核定。
 */

export const PACK_FORMAT = "CHA-database-aligned-export";
export const SUPPORTED_FORMAT_VERSIONS = [1, 2, 3];

/** 由匯入流程解析的綁定佔位符（合法）。 */
const BINDING_PATTERN =
  /^\$(auth\.uid\(\)|import_time|approval_time|sources?\[\d+\]\.id|source_versions?\[\d+\]\.id|document_chunks\[[^\]]+\]\.id|candidate_facts\[[^\]]+\]\.id)$/;

/** 代表「原文沒有附上」的內容佔位符。 */
const CONTENT_PLACEHOLDER_PATTERN = /^\$resolve_|^\$\{|^<[^>]*>$|^（?待填|^TODO/i;

export function isBindingPlaceholder(value: unknown): boolean {
  return typeof value === "string" && BINDING_PATTERN.test(value);
}

export function isContentPlaceholder(value: unknown): boolean {
  return (
    typeof value === "string" && CONTENT_PLACEHOLDER_PATTERN.test(value.trim())
  );
}

export const PROPOSITION_TYPES = [
  "substance_property",
  "chemistry_concept",
  "event",
  "agency_topic",
  "toxicology_mechanism",
  "domestic_policy",
  "foreign_policy",
  "research_literature",
  "health_advice",
];
export const RISK_LEVELS = ["low", "medium", "high"];
export const CANDIDATE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "needs_fix",
  "merged",
  "split",
];
export const REVIEW_ACTIONS = [
  "approve",
  "approve_with_edit",
  "reject",
  "needs_fix",
  "split",
  "merge",
  "reextract",
  "reopen",
  "external_correction",
];

/**
 * 分類的中文與常見寫法一律接受。
 *
 * 分類可複選，所以認不得的值是「丟掉這一個」而不是「整筆回落成某一類」；
 * 全部認不得就是空陣列＝未分類。舊的六類寫法也留著對應，
 * 讓早期整理的原子命題包還匯得進來。
 */
const PROPOSITION_TYPE_ALIASES: Record<string, string> = {
  物質與物理化學性質: "substance_property",
  物質: "substance_property",
  化學物質: "substance_property",
  物理化學性質: "substance_property",
  substance: "substance_property",
  substance_property: "substance_property",

  化學基本概念: "chemistry_concept",
  基本概念: "chemistry_concept",
  概念: "chemistry_concept",
  concept: "chemistry_concept",
  chemistry_concept: "chemistry_concept",

  事件: "event",
  event: "event",

  化學署主題: "agency_topic",
  署內主題: "agency_topic",
  主題: "agency_topic",
  topic: "agency_topic",
  agency_topic: "agency_topic",

  毒理與反應機制: "toxicology_mechanism",
  毒理: "toxicology_mechanism",
  毒理機制: "toxicology_mechanism",
  反應機制: "toxicology_mechanism",
  機制: "toxicology_mechanism",
  toxicology: "toxicology_mechanism",
  toxicology_mechanism: "toxicology_mechanism",

  國內治理政策: "domestic_policy",
  國內政策: "domestic_policy",
  國內法規: "domestic_policy",
  法規: "domestic_policy",
  政策: "domestic_policy",
  法規政策: "domestic_policy",
  policy: "domestic_policy",
  domestic_policy: "domestic_policy",

  國外治理政策: "foreign_policy",
  國外政策: "foreign_policy",
  國外法規: "foreign_policy",
  國際政策: "foreign_policy",
  foreign_policy: "foreign_policy",

  研究與期刊: "research_literature",
  研究: "research_literature",
  期刊: "research_literature",
  文獻: "research_literature",
  research: "research_literature",
  research_literature: "research_literature",

  醫學健康建議: "health_advice",
  健康建議: "health_advice",
  醫療建議: "health_advice",
  health_advice: "health_advice",
};

const RISK_LEVEL_ALIASES: Record<string, string> = {
  低: "low",
  低風險: "low",
  low: "low",
  中: "medium",
  中風險: "medium",
  medium: "medium",
  中等: "medium",
  高: "high",
  高風險: "high",
  high: "high",
};

const STATUS_ALIASES: Record<string, string> = {
  待審核: "pending",
  未審核: "pending",
  pending: "pending",
  核定: "approved",
  已核定: "approved",
  通過: "approved",
  approved: "approved",
  駁回: "rejected",
  已駁回: "rejected",
  不通過: "rejected",
  rejected: "rejected",
  待修正: "needs_fix",
  需修正: "needs_fix",
  待確認: "needs_fix",
  待查證: "needs_fix",
  needs_fix: "needs_fix",
  已合併: "merged",
  merged: "merged",
  已拆分: "split",
  split: "split",
};

const ACTION_ALIASES: Record<string, string> = {
  核定: "approve",
  approve: "approve",
  修正後核定: "approve_with_edit",
  approve_with_edit: "approve_with_edit",
  駁回: "reject",
  reject: "reject",
  待修正: "needs_fix",
  待確認: "needs_fix",
  needs_fix: "needs_fix",
  拆分: "split",
  split: "split",
  合併: "merge",
  merge: "merge",
  重新抽取: "reextract",
  reextract: "reextract",
  退回待審核: "reopen",
  // 整理者常把「狀態」寫進 action 欄位。待審核代表這一筆最後沒有做決定，
  // 對應到的動作就是退回待審核（ACTION_RESULT_STATUS.reopen === "pending"）。
  待審核: "reopen",
  未審核: "reopen",
  保留: "reopen",
  reopen: "reopen",
  外部校正: "external_correction",
  external_correction: "external_correction",
};

export interface PackChunk {
  paragraph_id: string;
  position?: number;
  block_type?: string;
  heading_path?: string[];
  text: string;
  char_start?: number;
  char_end?: number;
}

export interface PackCandidate {
  ref: string;
  statement: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  proposition_types: string[];
  conditions: Record<string, string | null>;
  source_quote: string;
  source_paragraph_id: string;
  risk_level: string;
  confidence: number;
  status: string;
  quality_flags: string[];
  quality_score: number;
  review_note: string | null;
  edited: boolean;
  original_statement: string | null;
  extraction_batch: string | null;
  /** true 表示引句對不上原文，已退回以整段為依據，必須人工確認。 */
  quote_fallback: boolean;
}

export interface PackReview {
  candidate_fact_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  changes: unknown;
}

export interface PackKnowledgeFact {
  ref?: string;
  candidate_fact_id: string;
  statement: string;
  tags: string[];
  status: string;
}

export interface PackJob {
  job_type: string;
  status: string;
  payload: unknown;
  result: unknown;
}

export interface PackSource {
  title: string;
  source_type: string;
  origin_url: string | null;
  mime_type: string | null;
  byte_size: number | null;
  content_hash: string | null;
}

export interface PackVersion {
  version: number;
  title: string | null;
  raw_text: string | null;
  parser_version: string;
  char_count: number;
}

export interface NormalizedArticle {
  source: PackSource;
  version: PackVersion;
  chunks: PackChunk[];
  candidates: PackCandidate[];
  reviews: PackReview[];
  knowledgeFacts: PackKnowledgeFact[];
  jobs: PackJob[];
  /** 原子命題包裡標為駁回、因此沒有匯入的編號。 */
  droppedRejected: string[];
}

export interface PackIssue {
  /** error：該筆被跳過（不影響其他筆）。warning：已自動補上或修正。 */
  level: "error" | "warning";
  where: string;
  message: string;
  hint?: string;
}

export interface PackSummary {
  articles: number;
  chunks: number;
  candidates: number;
  approved: number;
  /** 原子命題包裡標為駁回、被略過不匯入的筆數。 */
  rejected: number;
  needsFix: number;
  knowledgeFacts: number;
  reviews: number;
  /** 引句對不上、已退回整段並強制待審核的筆數。 */
  quoteFallbacks: number;
  skipped: number;
}

export interface PackValidation {
  /** 有沒有任何可匯入的內容。 */
  ok: boolean;
  articles: NormalizedArticle[];
  issues: PackIssue[];
  summary: PackSummary;
}

// --- 小工具 ----------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** 取第一個有內容的欄位，讓不同來源的欄位命名都能吃進來。 */
function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * 把一個列舉值正規化。
 *
 * 三種結果要分清楚，因為只有第三種需要提醒使用者：
 *   exact     已經是允許值
 *   alias     用別名對上了（例如「高」→ high）——這是正常用法，不是問題
 *   fallback  完全認不得，退回預設值——這一種才要警告
 *
 * 原本 alias 與 fallback 都回報「無法辨識」，一份 90 筆的原子命題包
 * 光是把 risk_level 寫成中文就產生一百多條假警告，真正的問題被埋掉了。
 */
function coerce(
  raw: unknown,
  aliases: Record<string, string>,
  allowed: string[],
  fallback: string,
): { value: string; how: "exact" | "alias" | "fallback" } {
  const input = text(raw).trim();
  if (!input) return { value: fallback, how: "exact" };
  if (allowed.includes(input)) return { value: input, how: "exact" };

  const mapped = aliases[input] ?? aliases[input.toLowerCase()];
  if (mapped) return { value: mapped, how: "alias" };

  return { value: fallback, how: "fallback" };
}

/**
 * 分類專用的正規化：可複選，所以回傳陣列。
 *
 * 接受單一字串、以頓號／逗號／斜線分隔的字串，或字串陣列。
 * 認不得的值放進 dropped 回報，不會拖垮整筆——分類本來就可以是空的。
 */
export function coerceTypes(raw: unknown): {
  value: string[];
  dropped: string[];
} {
  const candidates: string[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) candidates.push(text(item));
  } else {
    const single = text(raw).trim();
    if (single) candidates.push(...single.split(/[、，,／/|]/u));
  }

  const value: string[] = [];
  const dropped: string[] = [];

  for (const candidate of candidates) {
    const input = candidate.trim();
    if (!input) continue;

    const mapped = PROPOSITION_TYPES.includes(input)
      ? input
      : (PROPOSITION_TYPE_ALIASES[input] ??
        PROPOSITION_TYPE_ALIASES[input.toLowerCase()]);

    if (!mapped) {
      // 舊的「其他」不是分類，是「沒有分類」，靜靜丟掉不必回報。
      if (input !== "其他" && input.toLowerCase() !== "other") {
        dropped.push(input);
      }
      continue;
    }
    if (!value.includes(mapped)) value.push(mapped);
  }

  return { value, dropped };
}

/** 解析參照：$candidate_facts[C001].id → C001，也接受直接寫 C001。 */
export function candidateRef(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;

  const match = /^\$candidate_facts\[([^\]]+)\]\.id$/.exec(raw);
  if (match) return match[1];

  return raw.startsWith("$") ? null : raw;
}

export function chunkRef(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;

  const match = /^\$document_chunks\[([^\]]+)\]\.id$/.exec(raw);
  if (match) return match[1];

  return raw.startsWith("$") ? null : raw;
}

/**
 * 引句比對。
 * 允許用刪節號串接多段：「甲…乙」只要甲與乙都在原文中就算通過。
 */
export function quoteMatches(quote: string, paragraph: string): boolean {
  const segments = quote
    .split(/…+|\.{3,}|\[?略\]?/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (segments.length === 0) return false;
  return segments.every((segment) => quoteExistsInParagraph(segment, paragraph));
}

/**
 * 統一段落編號寫法：P-001、P001、1、第1段 都變成 P-001。
 *
 * 沒填時回傳 null，**不從索引編一個出來**。
 * 曾經是「第 n 筆就當作 P-00n」，結果沒寫段落的原子命題被掛到剛好同號的段落上——
 * 一句講內分泌疾病症狀的話被掛到圖片說明那一段。
 * 段落編號是可回溯性的一環，猜錯比留白嚴重得多。
 */
function normalizeParagraphId(raw: unknown): string | null {
  const value = text(raw).trim();
  if (!value) return null;

  const digits = /(\d+)/.exec(value);
  if (/^P-\d+$/i.test(value)) return value.toUpperCase();
  if (digits) return `P-${digits[1].padStart(3, "0")}`;
  return value;
}

/**
 * 這份檔案看起來是「個人原子知識庫」的包嗎？
 *
 * 兩個系統的匯入頁長得很像，檔案丟錯頁面時只會看到
 * 「沒有任何可匯入的原子命題」，完全看不出是走錯門。
 * 判斷依據是只有 PKB 才有的欄位，寧可漏判也不要誤導。
 */
function looksLikePersonalPack(raw: Record<string, unknown>): boolean {
  const items = asArray(pick(raw, "items"));
  if (items.length === 0) return false;

  // 有段落原文就是 CHA 的包，不要誤判。
  if (asArray(pick(raw, "document_chunks", "chunks", "paragraphs")).length > 0) {
    return false;
  }

  return items.some((item) => {
    const row = asRecord(item);
    if (!row) return false;
    return (
      "source_label" in row ||
      "source_type" in row ||
      "來源名稱" in row ||
      "來源分類" in row
    );
  });
}

const WRONG_PAGE_HINT =
  "這看起來是「個人原子知識庫」的原子知識包（有 items 與 source_label／source_type，但沒有段落原文）。" +
  "那一套走的是 /pkb/import，不比對原文，只要求標註來源。";

// --- 主流程 ----------------------------------------------------------------

const NO_SOURCE_HINT =
  "每一筆原子命題都要有可對照的原文：在 document_chunks 提供該段落的文字，" +
  "或直接在這筆原子命題裡加 paragraph_text 欄位。";

/**
 * 驗證並正規化文章包。
 * 支援三種外層形狀：
 *   { articles: [ 單篇, 單篇 ] }   多篇
 *   { sources: [...], ... }        原本的單篇
 *   { source: {...}, facts: [...] } 精簡單篇
 */
export function validateArticlePack(input: unknown): PackValidation {
  const issues: PackIssue[] = [];
  const root = asRecord(input);

  const empty: PackSummary = {
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

  if (!root) {
    issues.push({ level: "error", where: "檔案", message: "不是 JSON 物件" });
    return { ok: false, articles: [], issues, summary: empty };
  }

  const meta = asRecord(root.export_meta) ?? {};
  if (
    typeof meta.format_version === "number" &&
    !SUPPORTED_FORMAT_VERSIONS.includes(meta.format_version)
  ) {
    issues.push({
      level: "warning",
      where: "export_meta.format_version",
      message: `版本 ${meta.format_version} 未經測試，仍會嘗試匯入`,
    });
  }

  // 多篇：{ articles: [...] }；否則整份當成一篇。
  const rawArticles = Array.isArray(root.articles)
    ? root.articles
    : Array.isArray(root.documents)
      ? root.documents
      : [root];

  const articles: NormalizedArticle[] = [];
  const summary = { ...empty };

  rawArticles.forEach((rawArticle, index) => {
    const label = rawArticles.length > 1 ? `第 ${index + 1} 篇` : "文章";
    const article = normalizeArticle(asRecord(rawArticle) ?? {}, label, issues);

    if (!article) {
      summary.skipped += 1;
      return;
    }

    articles.push(article);
    summary.articles += 1;
    summary.chunks += article.chunks.length;
    summary.candidates += article.candidates.length;
    summary.approved += article.candidates.filter(
      (candidate) => candidate.status === "approved",
    ).length;
    summary.rejected += article.droppedRejected.length;
    summary.needsFix += article.candidates.filter(
      (candidate) => candidate.status === "needs_fix",
    ).length;
    summary.quoteFallbacks += article.candidates.filter(
      (candidate) => candidate.quote_fallback,
    ).length;
    summary.knowledgeFacts += article.knowledgeFacts.length;
    summary.reviews += article.reviews.length;
  });

  summary.skipped += issues.filter((issue) => issue.level === "error").length;

  return {
    ok: articles.length > 0 && summary.candidates > 0,
    articles,
    issues,
    summary,
  };
}

function normalizeArticle(
  raw: Record<string, unknown>,
  label: string,
  issues: PackIssue[],
): NormalizedArticle | null {
  // --- 來源 ---------------------------------------------------------------
  const sourceRaw =
    asRecord(pick(raw, "source")) ??
    asRecord(asArray(pick(raw, "sources"))[0]) ??
    {};

  const sourceList = asArray(pick(raw, "sources"));
  if (sourceList.length > 1) {
    issues.push({
      level: "warning",
      where: `${label}.sources`,
      message: `有 ${sourceList.length} 筆來源，只會使用第一筆。多篇文章請用 articles 陣列。`,
    });
  }

  const title =
    text(pick(sourceRaw, "title", "name", "標題")).trim() ||
    text(pick(raw, "title", "標題")).trim();

  if (!title) {
    issues.push({
      level: "error",
      where: `${label}.sources[0].title`,
      message: "缺少文章標題，這一篇整篇跳過",
    });
    return null;
  }

  const sourceTypeRaw = text(pick(sourceRaw, "source_type", "type")).trim();
  const sourceType = ["text", "file", "url"].includes(sourceTypeRaw)
    ? sourceTypeRaw
    : "url";

  // --- 段落 ---------------------------------------------------------------
  const chunkRows = asArray(
    pick(raw, "document_chunks", "chunks", "paragraphs", "段落"),
  );

  const chunks = new Map<string, PackChunk>();

  chunkRows.forEach((item, index) => {
    const row = asRecord(item);
    if (!row) return;

    // 段落清單本身沒給編號時才自動編號：這裡的順序就是它在文件中的位置。
    const paragraphId =
      normalizeParagraphId(pick(row, "paragraph_id", "ref", "id", "pid")) ??
      `P-${String(index + 1).padStart(3, "0")}`;

    const body = pick(row, "text", "paragraph_text", "content", "body", "原文");

    if (isContentPlaceholder(body) || text(body).trim().length === 0) {
      issues.push({
        level: "warning",
        where: `${label}.段落 ${paragraphId}`,
        message:
          "段落沒有實際文字，改由引用它的原子命題自帶原文（若也沒有就跳過該筆原子命題）",
        hint: NO_SOURCE_HINT,
      });
      return;
    }

    if (chunks.has(paragraphId)) {
      issues.push({
        level: "warning",
        where: `${label}.段落 ${paragraphId}`,
        message: "段落編號重複，保留第一筆",
      });
      return;
    }

    chunks.set(paragraphId, {
      paragraph_id: paragraphId,
      position: typeof row.position === "number" ? row.position : index,
      block_type: text(pick(row, "block_type")) || "paragraph",
      heading_path: asArray(pick(row, "heading_path", "headings")).map((value) =>
        text(value),
      ),
      text: text(body),
      char_start: typeof row.char_start === "number" ? row.char_start : 0,
      char_end: typeof row.char_end === "number" ? row.char_end : 0,
    });
  });

  // --- 候選原子命題 -----------------------------------------------------------
  const candidateRows = asArray(
    pick(raw, "candidate_facts", "facts", "candidates", "原子命題", "命題", "事實"),
  );

  if (candidateRows.length === 0) {
    issues.push({
      level: "error",
      where: `${label}.candidate_facts`,
      message: "沒有任何原子命題，這一篇整篇跳過",
      hint: looksLikePersonalPack(raw)
        ? WRONG_PAGE_HINT
        : "清單欄位可以叫 facts、candidate_facts、原子命題…；每一筆至少要有 statement。",
    });
    return null;
  }

  const candidates = new Map<string, PackCandidate>();
  /** 原子命題包裡標為駁回、因此不匯入的編號。 */
  const rejectedRefs: string[] = [];

  candidateRows.forEach((item, index) => {
    const row = asRecord(item);
    if (!row) return;

    const ref =
      text(pick(row, "ref", "id", "code", "編號")).trim() ||
      `C${String(index + 1).padStart(3, "0")}`;
    const where = `${label}.${ref}`;

    if (candidates.has(ref)) {
      issues.push({
        level: "warning",
        where,
        message: "編號重複，保留第一筆",
      });
      return;
    }

    const statement = text(
      pick(
        row,
        "statement",
        "fact",
        "sentence",
        "text",
        "原子命題",
        "命題",
        "事實",
        "敘述",
      ),
    ).trim();

    if (statement.length < 2) {
      issues.push({
        level: "error",
        where,
        message: "沒有原子命題敘述，這一筆跳過",
      });
      return;
    }

    const statusResult = coerce(
      pick(row, "status", "decision", "審核狀態", "人工決定"),
      STATUS_ALIASES,
      CANDIDATE_STATUSES,
      "pending",
    );

    // 標為駁回的原子命題不匯入。
    //
    // 駁回代表整理者已經判定「這句話不成立」。把它建成候選原子命題只會讓
    // 不成立的句子躺在待審清單裡，等著被全選批次核定一起放行——
    // 這正是先前發生過的事。要留紀錄請留在原子命題包裡，不要進資料庫。
    if (statusResult.value === "rejected") {
      rejectedRefs.push(ref);
      return;
    }

    // 段落：用指定的編號找；找不到就看這筆原子命題有沒有自帶原文。
    const paragraphId = normalizeParagraphId(
      pick(row, "source_paragraph_id", "paragraph_id", "paragraph", "段落"),
    );

    const inlineText = pick(
      row,
      "paragraph_text",
      "source_paragraph_text",
      "context",
      "段落原文",
    );

    const hasInlineText =
      !isContentPlaceholder(inlineText) && text(inlineText).trim().length > 0;

    let chunk = paragraphId ? chunks.get(paragraphId) : undefined;

    if (!chunk && hasInlineText) {
      // 原子命題自帶原文時就地補一個段落，不需要另外寫 document_chunks。
      const id = paragraphId ?? `P-${String(chunks.size + 1).padStart(3, "0")}`;
      chunk = {
        paragraph_id: id,
        position: chunks.size,
        block_type: "paragraph",
        heading_path: [],
        text: text(inlineText),
        char_start: 0,
        char_end: 0,
      };
      chunks.set(id, chunk);
    }

    if (!chunk) {
      issues.push({
        level: "error",
        where,
        message: paragraphId
          ? `找不到段落 ${paragraphId} 的原文，這一筆跳過`
          : "沒有指定段落，也沒有自帶原文，這一筆跳過",
        hint: NO_SOURCE_HINT,
      });
      return;
    }

    // 引句：對不上就退回整段，並強制回到待審核。
    const rawQuote = pick(row, "source_quote", "quote", "evidence", "原文片段");
    let quote = text(rawQuote).trim();
    let quoteFallback = false;

    if (!quote || isContentPlaceholder(rawQuote)) {
      quote = chunk.text;
      quoteFallback = true;
      issues.push({
        level: "warning",
        where,
        message: `沒有原文引句，改以段落 ${paragraphId} 全文為依據，狀態設為待審核`,
      });
    } else if (!quoteMatches(quote, chunk.text)) {
      quote = chunk.text;
      quoteFallback = true;
      issues.push({
        level: "warning",
        where,
        message: `引句不在段落 ${paragraphId} 中，改以整段為依據，狀態設為待審核`,
        hint: "引句要是該段落的連續片段；多段可用刪節號串接，例如「甲…乙」。",
      });
    }

    const typeResult = coerceTypes(
      pick(
        row,
        "proposition_types",
        "knowledge_type",
        "type",
        "types",
        "分類",
        "知識類型",
        "命題分類",
      ),
    );
    if (typeResult.dropped.length > 0) {
      issues.push({
        level: "warning",
        where,
        message: `分類「${typeResult.dropped.join("、")}」無法辨識，已略過`,
        hint: "分類可複選，認不得的值只會被丟掉，其餘照常匯入；全部認不得就是未分類。",
      });
    }

    const riskLevel = coerce(
      pick(row, "risk_level", "risk", "風險等級"),
      RISK_LEVEL_ALIASES,
      RISK_LEVELS,
      "medium",
    );
    if (riskLevel.how === "fallback") {
      issues.push({
        level: "warning",
        where,
        message: `risk_level 無法辨識，改用 ${riskLevel.value}`,
      });
    }

    if (statusResult.how === "fallback") {
      issues.push({
        level: "warning",
        where,
        message: `status 無法辨識，改用待審核`,
      });
    }

    // 引句退回整段時不得沿用「已核定」，一律回到待審核。
    const status = quoteFallback ? "pending" : statusResult.value;

    const conditionsRaw = asRecord(pick(row, "conditions", "條件")) ?? {};
    const conditions = Object.fromEntries(
      Object.entries(conditionsRaw).map(([key, value]) => [
        key,
        typeof value === "string" && value.trim() ? value : null,
      ]),
    );

    const flags = asArray(pick(row, "quality_flags", "flags")).map((value) =>
      text(value),
    );
    if (quoteFallback) flags.push("quote_not_verified");

    candidates.set(ref, {
      ref,
      statement,
      subject: text(pick(row, "subject", "主體")) || null,
      predicate: text(pick(row, "predicate", "關係")) || null,
      object: text(pick(row, "object", "客體")) || null,
      proposition_types: typeResult.value,
      conditions,
      source_quote: quote,
      source_paragraph_id: chunk.paragraph_id,
      risk_level: riskLevel.value,
      confidence:
        typeof row.confidence === "number"
          ? row.confidence
          : quoteFallback
            ? 0.4
            : 0.6,
      status,
      quality_flags: flags,
      quality_score:
        typeof row.quality_score === "number"
          ? row.quality_score
          : quoteFallback
            ? 60
            : 100,
      review_note:
        text(pick(row, "review_note", "note", "理由", "審核意見")) || null,
      edited: row.edited === true,
      original_statement: text(pick(row, "original_statement", "原始敘述")) || null,
      extraction_batch: text(pick(row, "extraction_batch")) || null,
      quote_fallback: quoteFallback,
    });
  });

  if (rejectedRefs.length > 0) {
    issues.push({
      level: "warning",
      where: `${label}.facts`,
      message: `略過 ${rejectedRefs.length} 筆標為駁回的原子命題（${rejectedRefs
        .slice(0, 5)
        .join(
          "、",
        )}${rejectedRefs.length > 5 ? " 等" : ""}），駁回的原子命題不會匯入`,
      hint: "駁回代表這句話不成立，建立成候選原子命題只會增加被誤放行的機會。要保留紀錄請留在原子命題包檔案裡。",
    });
  }

  if (candidates.size === 0) {
    issues.push({
      level: "error",
      where: `${label}`,
      message:
        rejectedRefs.length > 0
          ? "這一篇的原子命題全部標為駁回，沒有可匯入的內容"
          : "沒有任何可用的原子命題，這一篇整篇跳過",
    });
    return null;
  }

  // --- 審核紀錄 -----------------------------------------------------------
  const reviews: PackReview[] = [];
  asArray(pick(raw, "review_records", "reviews", "審核紀錄")).forEach(
    (item, index) => {
      const row = asRecord(item);
      if (!row) return;

      const ref = candidateRef(
        pick(row, "candidate_fact_id", "candidate_ref", "ref", "編號"),
      );
      if (!ref || !candidates.has(ref)) {
        issues.push({
          level: "warning",
          where: `${label}.審核紀錄 ${index + 1}`,
          message: "對應不到原子命題，略過這筆紀錄",
        });
        return;
      }

      const candidate = candidates.get(ref)!;
      const action = coerce(
        pick(row, "action", "decision", "動作"),
        ACTION_ALIASES,
        REVIEW_ACTIONS,
        candidate.status === "approved"
          ? "approve"
          : candidate.status === "rejected"
            ? "reject"
            : "needs_fix",
      );

      if (action.how === "fallback") {
        issues.push({
          level: "warning",
          where: `${label}.審核紀錄 ${index + 1}`,
          message: `審核動作無法辨識，改用 ${action.value}`,
        });
      }

      reviews.push({
        candidate_fact_id: ref,
        action: action.value,
        from_status: text(pick(row, "from_status")) || "pending",
        to_status: text(pick(row, "to_status")) || candidate.status,
        note: text(pick(row, "note", "理由")) || null,
        changes: row.changes ?? {},
      });
    },
  );

  // --- 正式原子命題 -----------------------------------------------------------
  const knowledgeFacts: PackKnowledgeFact[] = [];
  asArray(pick(raw, "knowledge_facts", "final_facts", "正式原子命題")).forEach(
    (item, index) => {
      const row = asRecord(item);
      if (!row) return;

      const where = `${label}.正式原子命題 ${text(pick(row, "ref")) || index + 1}`;
      const ref = candidateRef(
        pick(row, "candidate_fact_id", "candidate_ref", "from", "編號"),
      );

      if (!ref || !candidates.has(ref)) {
        issues.push({
          level: "warning",
          where,
          message:
            "對應不到原子命題，略過。正式原子命題必須由某一筆原子命題核定而來。",
        });
        return;
      }

      const candidate = candidates.get(ref)!;
      if (candidate.status !== "approved") {
        issues.push({
          level: "warning",
          where,
          message: `對應的原子命題 ${ref} 目前是${candidate.status}，略過這筆正式原子命題`,
          hint: candidate.quote_fallback
            ? "因為引句對不上原文而退回待審核，核定後就會產生正式原子命題。"
            : undefined,
        });
        return;
      }

      knowledgeFacts.push({
        ref: text(pick(row, "ref")) || undefined,
        candidate_fact_id: ref,
        statement: candidate.statement,
        tags: asArray(pick(row, "tags", "標籤")).map((value) => text(value)),
        status: "active",
      });
    },
  );

  // --- 版本與工作 ---------------------------------------------------------
  const versionRaw =
    asRecord(asArray(pick(raw, "source_versions"))[0]) ??
    asRecord(pick(raw, "source_version")) ??
    {};

  const orderedChunks = [...chunks.values()].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  const jobs = asArray(pick(raw, "processing_jobs", "jobs")).map((item) => {
    const row = asRecord(item) ?? {};
    return {
      job_type: text(pick(row, "job_type")) || "extract_facts",
      status: text(pick(row, "status")) || "completed",
      payload: row.payload ?? {},
      result: row.result ?? {},
    };
  });

  return {
    source: {
      title,
      source_type: sourceType,
      origin_url: text(pick(sourceRaw, "origin_url", "url", "網址")) || null,
      mime_type: text(pick(sourceRaw, "mime_type")) || null,
      byte_size:
        typeof sourceRaw.byte_size === "number" ? sourceRaw.byte_size : null,
      content_hash: isBindingPlaceholder(sourceRaw.content_hash)
        ? null
        : text(pick(sourceRaw, "content_hash")) || null,
    },
    version: {
      version: typeof versionRaw.version === "number" ? versionRaw.version : 1,
      title: text(pick(versionRaw, "title")) || title,
      raw_text: isContentPlaceholder(versionRaw.raw_text)
        ? null
        : text(pick(versionRaw, "raw_text")) || null,
      parser_version:
        text(pick(versionRaw, "parser_version")) || "article-pack/3.0",
      char_count:
        typeof versionRaw.char_count === "number" ? versionRaw.char_count : 0,
    },
    chunks: orderedChunks,
    candidates: [...candidates.values()],
    reviews,
    knowledgeFacts,
    jobs,
    droppedRejected: rejectedRefs,
  };
}
