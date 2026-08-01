import { quoteExistsInParagraph } from "./quality.ts";

/**
 * 文章包（CHA-database-aligned-export）：在對話或其他工具中整理好的一篇文章，
 * 連同段落、候選事實、審核紀錄與正式事實一次匯入。
 *
 * 設計上區分兩種佔位符：
 * - 綁定佔位符（$auth.uid()、$sources[0].id、$import_time…）
 *   指的是「由資料庫或匯入流程產生的值」，匯入時解析，合法。
 * - 內容佔位符（$resolve_source_paragraph、$resolve_quote…）
 *   指的是「原文內容本身沒有放進檔案」。
 *   這種一律擋下：沒有原文就無法驗證事實是否超出原文，
 *   整個專案的可回溯性就沒有意義了。
 */

export const PACK_FORMAT = "CHA-database-aligned-export";
export const SUPPORTED_FORMAT_VERSIONS = [1, 2];

/** 由匯入流程解析的綁定佔位符。 */
const BINDING_PATTERN =
  /^\$(auth\.uid\(\)|import_time|approval_time|sources\[\d+\]\.id|source_versions\[\d+\]\.id|document_chunks\[[^\]]+\]\.id|candidate_facts\[[^\]]+\]\.id)$/;

/** 代表「原文沒有附上」的內容佔位符。 */
const CONTENT_PLACEHOLDER_PATTERN = /^\$resolve_/;

export function isBindingPlaceholder(value: unknown): boolean {
  return typeof value === "string" && BINDING_PATTERN.test(value);
}

export function isContentPlaceholder(value: unknown): boolean {
  return typeof value === "string" && CONTENT_PLACEHOLDER_PATTERN.test(value);
}

export const KNOWLEDGE_TYPES = [
  "substance",
  "concept",
  "policy",
  "event",
  "topic",
  "other",
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
export const SOURCE_TYPES = ["text", "file", "url"];

export interface PackSource {
  title: string;
  source_type: string;
  origin_url: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  content_hash?: string | null;
  status?: string;
}

export interface PackVersion {
  version?: number;
  title?: string | null;
  raw_text?: string | null;
  parser_version?: string;
  char_count?: number;
  chunk_count?: number;
}

export interface PackChunk {
  ref?: string;
  paragraph_id: string;
  position?: number;
  block_type?: string;
  heading_path?: string[];
  text: string;
  char_start?: number;
  char_end?: number;
  content_hash?: string;
}

export interface PackCandidate {
  ref: string;
  statement: string;
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
  knowledge_type?: string;
  conditions?: Record<string, string | null>;
  source_quote: string;
  source_paragraph_id: string;
  risk_level?: string;
  confidence?: number;
  status?: string;
  quality_flags?: string[];
  quality_score?: number;
  review_note?: string | null;
  edited?: boolean;
  original_statement?: string | null;
  extraction_batch?: string | null;
}

export interface PackReview {
  candidate_fact_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  note?: string | null;
  changes?: unknown;
}

export interface PackKnowledgeFact {
  ref?: string;
  candidate_fact_id: string;
  statement: string;
  tags?: string[];
  status?: string;
}

export interface PackJob {
  job_type?: string;
  status?: string;
  payload?: unknown;
  result?: unknown;
}

export interface ArticlePack {
  export_meta: Record<string, unknown>;
  sources: PackSource[];
  source_versions: PackVersion[];
  document_chunks: PackChunk[];
  candidate_facts: PackCandidate[];
  review_records: PackReview[];
  knowledge_facts: PackKnowledgeFact[];
  processing_jobs: PackJob[];
}

export interface PackIssue {
  /** error 會擋下匯入；warning 只提醒。 */
  level: "error" | "warning";
  where: string;
  message: string;
  hint?: string;
}

export interface PackValidation {
  ok: boolean;
  pack: ArticlePack | null;
  issues: PackIssue[];
  summary: {
    chunks: number;
    candidates: number;
    approved: number;
    rejected: number;
    knowledgeFacts: number;
    reviews: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 解析候選事實參照：$candidate_facts[C001].id → C001，也接受直接寫 C001。 */
export function candidateRef(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;

  const match = /^\$candidate_facts\[([^\]]+)\]\.id$/.exec(raw);
  if (match) return match[1];

  return raw.startsWith("$") ? null : raw;
}

/** 解析段落參照：$document_chunks[P-004].id → P-004。 */
export function chunkRef(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;

  const match = /^\$document_chunks\[([^\]]+)\]\.id$/.exec(raw);
  if (match) return match[1];

  return raw.startsWith("$") ? null : raw;
}

const CONTENT_HINT =
  "請把這個欄位換成真正的文字內容。匯入端無法從網址自動還原是原文的哪一段、哪一句。";

/**
 * 驗證文章包。
 * 只做結構與內容檢查，不碰資料庫；因此可以完整單元測試，
 * 也可以在匯入前先讓使用者看到全部問題。
 */
export function validateArticlePack(input: unknown): PackValidation {
  const issues: PackIssue[] = [];
  const empty = {
    chunks: 0,
    candidates: 0,
    approved: 0,
    rejected: 0,
    knowledgeFacts: 0,
    reviews: 0,
  };

  const root = asRecord(input);
  if (!root) {
    issues.push({ level: "error", where: "檔案", message: "不是 JSON 物件" });
    return { ok: false, pack: null, issues, summary: empty };
  }

  const meta = asRecord(root.export_meta) ?? {};
  if (meta.format && meta.format !== PACK_FORMAT) {
    issues.push({
      level: "warning",
      where: "export_meta.format",
      message: `格式標示為「${String(meta.format)}」，預期是「${PACK_FORMAT}」`,
    });
  }
  if (
    typeof meta.format_version === "number" &&
    !SUPPORTED_FORMAT_VERSIONS.includes(meta.format_version)
  ) {
    issues.push({
      level: "warning",
      where: "export_meta.format_version",
      message: `版本 ${meta.format_version} 未經測試，目前支援 ${SUPPORTED_FORMAT_VERSIONS.join("、")}`,
    });
  }

  // --- sources ---------------------------------------------------------
  const sources = asArray(root.sources).map((item) => asRecord(item) ?? {});
  if (sources.length !== 1) {
    issues.push({
      level: "error",
      where: "sources",
      message: `一個檔案必須剛好一筆 sources，目前有 ${sources.length} 筆`,
    });
  }

  const source = sources[0] ?? {};
  if (!text(source.title).trim()) {
    issues.push({ level: "error", where: "sources[0].title", message: "缺少標題" });
  }
  const sourceType = text(source.source_type) || "url";
  if (!SOURCE_TYPES.includes(sourceType)) {
    issues.push({
      level: "error",
      where: "sources[0].source_type",
      message: `不是允許值（${SOURCE_TYPES.join(" | ")}）`,
    });
  }

  // --- document_chunks -------------------------------------------------
  const chunks = asArray(root.document_chunks).map((item) => asRecord(item) ?? {});
  if (chunks.length === 0) {
    issues.push({
      level: "error",
      where: "document_chunks",
      message: "沒有任何段落。事實必須能對應到原文段落。",
    });
  }

  const chunkByParagraph = new Map<string, PackChunk>();
  // 段落有列出但內容不能用時，後面的事實要說得出真正的原因，
  // 不能只回報「找不到段落」讓人以為是漏了段落。
  const unusableParagraphs = new Map<string, string>();

  for (const [index, chunk] of chunks.entries()) {
    const where = `document_chunks[${index}]`;
    const paragraphId = text(chunk.paragraph_id).trim();

    if (!paragraphId) {
      issues.push({ level: "error", where, message: "缺少 paragraph_id" });
      continue;
    }
    if (chunkByParagraph.has(paragraphId)) {
      issues.push({
        level: "error",
        where,
        message: `paragraph_id ${paragraphId} 重複`,
      });
      continue;
    }

    const body = chunk.text;
    if (isContentPlaceholder(body)) {
      issues.push({
        level: "error",
        where: `${where}.text（${paragraphId}）`,
        message: `段落文字還是佔位符「${text(body)}」`,
        hint: CONTENT_HINT,
      });
      unusableParagraphs.set(paragraphId, "段落文字還是佔位符");
      continue;
    }
    if (text(body).trim().length === 0) {
      issues.push({
        level: "error",
        where: `${where}.text（${paragraphId}）`,
        message: "段落文字是空的",
        hint: CONTENT_HINT,
      });
      unusableParagraphs.set(paragraphId, "段落文字是空的");
      continue;
    }

    chunkByParagraph.set(paragraphId, {
      paragraph_id: paragraphId,
      position: typeof chunk.position === "number" ? chunk.position : index,
      block_type: text(chunk.block_type) || "paragraph",
      heading_path: asArray(chunk.heading_path).map((item) => text(item)),
      text: text(body),
      char_start: typeof chunk.char_start === "number" ? chunk.char_start : 0,
      char_end: typeof chunk.char_end === "number" ? chunk.char_end : 0,
    });
  }

  // --- candidate_facts -------------------------------------------------
  const candidates = asArray(root.candidate_facts).map(
    (item) => asRecord(item) ?? {},
  );
  const candidateByRef = new Map<string, PackCandidate>();
  let approved = 0;
  let rejected = 0;

  for (const [index, candidate] of candidates.entries()) {
    const ref = text(candidate.ref).trim() || `#${index + 1}`;
    const where = `candidate_facts[${ref}]`;

    if (candidateByRef.has(ref)) {
      issues.push({ level: "error", where, message: `ref ${ref} 重複` });
      continue;
    }

    const statement = text(candidate.statement).trim();
    if (statement.length < 4) {
      issues.push({ level: "error", where, message: "statement 太短或缺少" });
      continue;
    }

    const paragraphId = text(candidate.source_paragraph_id).trim();
    const chunk = chunkByParagraph.get(paragraphId);
    if (!chunk) {
      const reason = unusableParagraphs.get(paragraphId);
      issues.push({
        level: "error",
        where: `${where}.source_paragraph_id`,
        message: reason
          ? `無法使用段落 ${paragraphId}：${reason}`
          : `找不到段落 ${paragraphId || "（空白）"}`,
        hint: reason
          ? "修好上面那一段的文字，這筆事實就會一併通過。"
          : "document_chunks 必須包含每一筆事實引用的段落。",
      });
      continue;
    }

    const quote = candidate.source_quote;
    if (isContentPlaceholder(quote)) {
      issues.push({
        level: "error",
        where: `${where}.source_quote`,
        message: `原文引句還是佔位符「${text(quote)}」`,
        hint: CONTENT_HINT,
      });
      continue;
    }
    if (text(quote).trim().length === 0) {
      issues.push({
        level: "error",
        where: `${where}.source_quote`,
        message: "缺少原文引句",
        hint: "沒有引句就無法判斷事實是否超出原文，這類事實不得進入核定流程。",
      });
      continue;
    }
    if (!quoteExistsInParagraph(text(quote), chunk.text)) {
      issues.push({
        level: "error",
        where: `${where}.source_quote`,
        message: `引句不在段落 ${paragraphId} 的文字中`,
        hint: "引句必須是該段落的連續片段（可忽略空白與標點差異）。",
      });
      continue;
    }

    const knowledgeType = text(candidate.knowledge_type) || "other";
    if (!KNOWLEDGE_TYPES.includes(knowledgeType)) {
      issues.push({
        level: "error",
        where: `${where}.knowledge_type`,
        message: `「${knowledgeType}」不是允許值`,
      });
      continue;
    }

    const riskLevel = text(candidate.risk_level) || "low";
    if (!RISK_LEVELS.includes(riskLevel)) {
      issues.push({
        level: "error",
        where: `${where}.risk_level`,
        message: `「${riskLevel}」不是允許值`,
      });
      continue;
    }

    const status = text(candidate.status) || "pending";
    if (!CANDIDATE_STATUSES.includes(status)) {
      issues.push({
        level: "error",
        where: `${where}.status`,
        message: `「${status}」不是允許值`,
      });
      continue;
    }
    if (status === "approved") approved += 1;
    if (status === "rejected") rejected += 1;

    const conditions = asRecord(candidate.conditions) ?? {};

    candidateByRef.set(ref, {
      ref,
      statement,
      subject: text(candidate.subject) || null,
      predicate: text(candidate.predicate) || null,
      object: text(candidate.object) || null,
      knowledge_type: knowledgeType,
      conditions: Object.fromEntries(
        Object.entries(conditions).map(([key, value]) => [
          key,
          typeof value === "string" ? value : null,
        ]),
      ),
      source_quote: text(quote),
      source_paragraph_id: paragraphId,
      risk_level: riskLevel,
      confidence:
        typeof candidate.confidence === "number" ? candidate.confidence : 0.5,
      status,
      quality_flags: asArray(candidate.quality_flags).map((item) => text(item)),
      quality_score:
        typeof candidate.quality_score === "number" ? candidate.quality_score : 100,
      review_note: text(candidate.review_note) || null,
      edited: candidate.edited === true,
      original_statement: text(candidate.original_statement) || null,
      extraction_batch: text(candidate.extraction_batch) || null,
    });
  }

  if (candidateByRef.size === 0) {
    issues.push({
      level: "error",
      where: "candidate_facts",
      message: "沒有任何可用的候選事實",
    });
  }

  // --- review_records --------------------------------------------------
  const reviews: PackReview[] = [];
  for (const [index, review] of asArray(root.review_records).entries()) {
    const row = asRecord(review) ?? {};
    const where = `review_records[${index}]`;
    const ref = candidateRef(row.candidate_fact_id);

    if (!ref || !candidateByRef.has(ref)) {
      issues.push({
        level: "warning",
        where,
        message: `對應不到候選事實 ${ref ?? "（空白）"}，這筆審核紀錄會被略過`,
      });
      continue;
    }

    const action = text(row.action);
    if (!REVIEW_ACTIONS.includes(action)) {
      issues.push({
        level: "error",
        where: `${where}.action`,
        message: `「${action}」不是允許的審核動作`,
      });
      continue;
    }

    reviews.push({
      candidate_fact_id: ref,
      action,
      from_status: text(row.from_status) || null,
      to_status: text(row.to_status) || null,
      note: text(row.note) || null,
      changes: row.changes ?? {},
    });
  }

  // --- knowledge_facts -------------------------------------------------
  const knowledgeFacts: PackKnowledgeFact[] = [];
  for (const [index, fact] of asArray(root.knowledge_facts).entries()) {
    const row = asRecord(fact) ?? {};
    const where = `knowledge_facts[${text(row.ref) || index}]`;
    const ref = candidateRef(row.candidate_fact_id);

    if (!ref || !candidateByRef.has(ref)) {
      issues.push({
        level: "error",
        where,
        message: `對應不到候選事實 ${ref ?? "（空白）"}`,
        hint: "正式事實必須由某一筆候選事實核定而來，才能保留審核歷程。",
      });
      continue;
    }

    const candidate = candidateByRef.get(ref)!;
    if (candidate.status !== "approved") {
      issues.push({
        level: "error",
        where,
        message: `對應的候選事實 ${ref} 狀態是 ${candidate.status}，不是 approved`,
        hint: "未經核定的候選事實不得產生正式事實。",
      });
      continue;
    }

    const statement = text(row.statement).trim();
    if (statement && statement !== candidate.statement) {
      issues.push({
        level: "warning",
        where,
        message: `敘述與候選事實 ${ref} 不一致，匯入時以候選事實為準`,
      });
    }

    knowledgeFacts.push({
      ref: text(row.ref) || undefined,
      candidate_fact_id: ref,
      statement: candidate.statement,
      tags: asArray(row.tags).map((item) => text(item)),
      status: text(row.status) || "active",
    });
  }

  // 已核定但沒有對應正式事實：提醒，不擋。
  const promoted = new Set(knowledgeFacts.map((fact) => fact.candidate_fact_id));
  for (const candidate of candidateByRef.values()) {
    if (candidate.status === "approved" && !promoted.has(candidate.ref)) {
      issues.push({
        level: "warning",
        where: `candidate_facts[${candidate.ref}]`,
        message: "狀態是已核定，但檔案中沒有對應的正式事實",
      });
    }
  }

  const version = asRecord(asArray(root.source_versions)[0]) ?? {};
  const jobs = asArray(root.processing_jobs).map((item) => asRecord(item) ?? {});

  const summary = {
    chunks: chunkByParagraph.size,
    candidates: candidateByRef.size,
    approved,
    rejected,
    knowledgeFacts: knowledgeFacts.length,
    reviews: reviews.length,
  };

  const ok = !issues.some((issue) => issue.level === "error");

  return {
    ok,
    issues,
    summary,
    pack: ok
      ? {
          export_meta: meta,
          sources: [
            {
              title: text(source.title),
              source_type: sourceType,
              origin_url: text(source.origin_url) || null,
              mime_type: text(source.mime_type) || null,
              byte_size:
                typeof source.byte_size === "number" ? source.byte_size : null,
              content_hash: isBindingPlaceholder(source.content_hash)
                ? null
                : text(source.content_hash) || null,
              status: "ready",
            },
          ],
          source_versions: [
            {
              version: typeof version.version === "number" ? version.version : 1,
              title: text(version.title) || text(source.title),
              raw_text: isContentPlaceholder(version.raw_text)
                ? null
                : text(version.raw_text) || null,
              parser_version: text(version.parser_version) || "article-pack/1.0",
              char_count:
                typeof version.char_count === "number" ? version.char_count : 0,
              chunk_count: chunkByParagraph.size,
            },
          ],
          document_chunks: [...chunkByParagraph.values()].sort(
            (a, b) => (a.position ?? 0) - (b.position ?? 0),
          ),
          candidate_facts: [...candidateByRef.values()],
          review_records: reviews,
          knowledge_facts: knowledgeFacts,
          processing_jobs: jobs.map((job) => ({
            job_type: text(job.job_type) || "extract_facts",
            status: text(job.status) || "completed",
            payload: job.payload ?? {},
            result: job.result ?? {},
          })),
        }
      : null,
  };
}
