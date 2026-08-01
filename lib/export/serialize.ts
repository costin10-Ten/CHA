/**
 * 匯出格式（工作單第 17 節）。
 *
 * 這個檔案只做「資料 → 字串」的轉換，不碰資料庫也不碰 Next.js，
 * 因此可以完整單元測試，也不會在測試時需要連線。
 */

export interface ExportFact {
  id: string;
  statement: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  knowledge_type: string;
  risk_level: string;
  status: string;
  version: number;
  conditions: Record<string, string | null> | null;
  source_id: string;
  source_paragraph_id: string;
  source_quote: string;
  created_at: string;
}

export interface ExportSource {
  id: string;
  title: string;
  source_type: string;
  origin_url: string | null;
  content_hash: string | null;
  created_at: string;
}

export type ExportFormat = "json" | "csv" | "markdown";

export function isExportFormat(value: string): value is ExportFormat {
  return value === "json" || value === "csv" || value === "markdown";
}

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
};

export const FILE_EXTENSION: Record<ExportFormat, string> = {
  json: "json",
  csv: "csv",
  markdown: "md",
};

/** RFC 4180：欄位內有逗號、引號或換行時要用引號包起來，內部引號重複兩次。 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  // Excel 預設用系統編碼開 CSV，加 BOM 才不會把中文顯示成亂碼。
  return `﻿${lines.join("\r\n")}\r\n`;
}

const FACT_COLUMNS = [
  "id",
  "statement",
  "subject",
  "predicate",
  "object",
  "knowledge_type",
  "risk_level",
  "status",
  "version",
  "conditions",
  "source_id",
  "source_title",
  "source_url",
  "source_paragraph_id",
  "source_quote",
  "created_at",
];

export interface ExportBundle {
  facts: ExportFact[];
  sources: ExportSource[];
  exportedAt?: string;
}

function sourceIndex(sources: ExportSource[]): Map<string, ExportSource> {
  return new Map(sources.map((source) => [source.id, source]));
}

function conditionText(conditions: Record<string, string | null> | null): string {
  const entries = Object.entries(conditions ?? {}).filter(([, value]) => value);
  return entries.length === 0
    ? ""
    : entries.map(([key, value]) => `${key}=${value}`).join("; ");
}

export function factsToCsv(bundle: ExportBundle): string {
  const byId = sourceIndex(bundle.sources);

  const rows = bundle.facts.map((fact) => {
    const source = byId.get(fact.source_id);
    return {
      ...fact,
      conditions: conditionText(fact.conditions),
      source_title: source?.title ?? "",
      source_url: source?.origin_url ?? "",
    };
  });

  return toCsv(rows, FACT_COLUMNS);
}

export function factsToJson(bundle: ExportBundle): string {
  return `${JSON.stringify(
    {
      exported_at: bundle.exportedAt ?? new Date().toISOString(),
      fact_count: bundle.facts.length,
      source_count: bundle.sources.length,
      note: "每一筆事實都附帶 source_quote 與 source_paragraph_id，可回溯到原文段落。",
      sources: bundle.sources,
      facts: bundle.facts,
    },
    null,
    2,
  )}\n`;
}

/** Markdown：依來源文件分組，方便直接閱讀或貼進文件。 */
export function factsToMarkdown(bundle: ExportBundle): string {
  const byId = sourceIndex(bundle.sources);
  const grouped = new Map<string, ExportFact[]>();

  for (const fact of bundle.facts) {
    const list = grouped.get(fact.source_id) ?? [];
    list.push(fact);
    grouped.set(fact.source_id, list);
  }

  const lines: string[] = [
    "# 正式事實匯出",
    "",
    `匯出時間：${bundle.exportedAt ?? new Date().toISOString()}`,
    `事實筆數：${bundle.facts.length}．來源文件：${bundle.sources.length}`,
    "",
  ];

  for (const [sourceId, facts] of grouped) {
    const source = byId.get(sourceId);
    lines.push(`## ${source?.title ?? "未知來源"}`, "");
    if (source?.origin_url) lines.push(`來源網址：${source.origin_url}`, "");

    for (const fact of facts) {
      lines.push(`### ${fact.statement}`, "");
      lines.push(
        `- 知識類型：${fact.knowledge_type}．風險等級：${fact.risk_level}．版本：v${fact.version}`,
      );

      const conditions = conditionText(fact.conditions);
      if (conditions) lines.push(`- 適用條件：${conditions}`);

      lines.push(`- 原文段落：${fact.source_paragraph_id}`);
      lines.push(`- 原文片段：${fact.source_quote}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function serializeFacts(bundle: ExportBundle, format: ExportFormat): string {
  if (format === "csv") return factsToCsv(bundle);
  if (format === "markdown") return factsToMarkdown(bundle);
  return factsToJson(bundle);
}

/**
 * 正式事實與來源對照表（工作單第 17 節）。
 * 一列一筆事實，明確寫出它出自哪一份文件的哪一段、依據哪一句原文。
 */
const MAPPING_COLUMNS = [
  "fact_id",
  "statement",
  "version",
  "source_id",
  "source_title",
  "source_type",
  "source_url",
  "content_hash",
  "paragraph_id",
  "source_quote",
];

export function mappingRows(bundle: ExportBundle): Record<string, unknown>[] {
  const byId = sourceIndex(bundle.sources);

  return bundle.facts.map((fact) => {
    const source = byId.get(fact.source_id);
    return {
      fact_id: fact.id,
      statement: fact.statement,
      version: fact.version,
      source_id: fact.source_id,
      source_title: source?.title ?? "",
      source_type: source?.source_type ?? "",
      source_url: source?.origin_url ?? "",
      content_hash: source?.content_hash ?? "",
      paragraph_id: fact.source_paragraph_id,
      source_quote: fact.source_quote,
    };
  });
}

export function mappingToCsv(bundle: ExportBundle): string {
  return toCsv(mappingRows(bundle), MAPPING_COLUMNS);
}

export function mappingToMarkdown(bundle: ExportBundle): string {
  const rows = mappingRows(bundle);
  const header = ["事實", "版本", "來源文件", "段落", "原文片段"];

  // Markdown 表格不能有未逸出的 |，也不能有換行。
  const cell = (value: unknown) =>
    String(value ?? "")
      .replaceAll("|", "\\|")
      .replaceAll("\n", " ");

  const lines = [
    "# 正式事實與來源對照表",
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];

  for (const row of rows) {
    lines.push(
      `| ${[
        cell(row.statement),
        `v${row.version}`,
        cell(row.source_title),
        cell(row.paragraph_id),
        cell(row.source_quote),
      ].join(" | ")} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function mappingToJson(bundle: ExportBundle): string {
  return `${JSON.stringify(
    {
      exported_at: bundle.exportedAt ?? new Date().toISOString(),
      row_count: bundle.facts.length,
      rows: mappingRows(bundle),
    },
    null,
    2,
  )}\n`;
}

export function serializeMapping(
  bundle: ExportBundle,
  format: ExportFormat,
): string {
  if (format === "csv") return mappingToCsv(bundle);
  if (format === "markdown") return mappingToMarkdown(bundle);
  return mappingToJson(bundle);
}

export interface DocumentExport extends ExportBundle {
  source: ExportSource;
  /** 文件全文段落，讓匯出的文件本身也可還原。 */
  paragraphs: { paragraph_id: string; text: string }[];
}

/** 單篇文件與其事實（工作單第 17 節）。 */
export function documentToMarkdown(input: DocumentExport): string {
  const lines: string[] = [
    `# ${input.source.title}`,
    "",
    `類型：${input.source.source_type}`,
  ];

  if (input.source.origin_url) lines.push(`來源網址：${input.source.origin_url}`);
  if (input.source.content_hash) {
    lines.push(`內容雜湊：${input.source.content_hash}`);
  }

  lines.push("", "## 原文", "");
  for (const paragraph of input.paragraphs) {
    lines.push(`**${paragraph.paragraph_id}**　${paragraph.text}`, "");
  }

  lines.push(`## 由本文產生的正式事實（${input.facts.length} 筆）`, "");
  for (const fact of input.facts) {
    lines.push(`- ${fact.statement}`);
    lines.push(`  - 段落：${fact.source_paragraph_id}`);
    lines.push(`  - 原文片段：${fact.source_quote}`);

    const conditions = conditionText(fact.conditions);
    if (conditions) lines.push(`  - 適用條件：${conditions}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function documentToJson(input: DocumentExport): string {
  return `${JSON.stringify(
    {
      exported_at: input.exportedAt ?? new Date().toISOString(),
      source: input.source,
      paragraphs: input.paragraphs,
      facts: input.facts,
    },
    null,
    2,
  )}\n`;
}

export function serializeDocument(
  input: DocumentExport,
  format: ExportFormat,
): string {
  if (format === "csv") return factsToCsv(input);
  if (format === "markdown") return documentToMarkdown(input);
  return documentToJson(input);
}

/** 檔名：避免斜線與空白造成下載問題。 */
export function exportFilename(
  kind: string,
  format: ExportFormat,
  stamp = new Date(),
): string {
  const date = stamp.toISOString().slice(0, 10);
  const safe = kind.replaceAll(/[^\w-]/g, "-");
  return `${safe}-${date}.${FILE_EXTENSION[format]}`;
}
