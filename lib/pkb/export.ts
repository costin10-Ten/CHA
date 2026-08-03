import { PKB_SOURCE_TYPE_LABEL } from "@shared/pkb-pack.ts";

import type { PkbItemRow } from "@/lib/supabase/types";

/**
 * 把已同意的原子知識匯出成可以直接交給其他 LLM 的檔案。
 *
 * 純函式、不碰資料庫，方便完整測試。
 *
 * 兩個格式：
 * - Markdown：貼進對話用。開頭有一段給模型看的使用說明
 * - JSONL：一行一筆，給程式處理用
 *
 * 不管哪一種，**自製內容都必須明確標示**。模擬題與正式發想點是使用者
 * 自己寫的，不是外部依據；不標示的話，模型會把使用者的發想當成既有事實
 * 引用回來，等於自己的猜測繞一圈變成「查到的資料」。
 */

export type PkbExportFormat = "markdown" | "jsonl";

export const PKB_EXPORT_CONTENT_TYPE: Record<PkbExportFormat, string> = {
  markdown: "text/markdown; charset=utf-8",
  jsonl: "application/x-ndjson; charset=utf-8",
};

export const PKB_EXPORT_EXTENSION: Record<PkbExportFormat, string> = {
  markdown: "md",
  jsonl: "jsonl",
};

/** 放在 Markdown 最前面，告訴模型這份東西該怎麼用。 */
export const PKB_USAGE_NOTICE = [
  "本檔是一份個人整理的原子知識庫，每一筆都是一句可獨立閱讀的敘述，並標註來源。",
  "",
  "使用時請遵守：",
  "",
  "1. 回答只能依據本檔的內容，不要補充檔案裡沒有的知識。",
  "2. 引用時要附上該筆的來源（來源名稱，有網址就附網址）。",
  "3. **標示「自製」的項目是本人的模擬題或發想，不是外部依據**——",
  "   可以拿來理解本人的想法或立場，但不得當成既有事實或查證結果引用。",
  "4. 檔案裡找不到答案時，明說找不到，不要用一般知識填補。",
].join("\n");

function escapeInline(text: string): string {
  return text.replace(/\r?\n/g, " ").trim();
}

function sourceLine(item: PkbItemRow): string {
  const parts = [
    PKB_SOURCE_TYPE_LABEL[item.source_type] ?? item.source_type,
    escapeInline(item.source_label),
  ];
  if (item.source_url) parts.push(item.source_url);
  if (item.source_note) parts.push(escapeInline(item.source_note));
  return parts.join("｜");
}

export function toPkbMarkdown(items: PkbItemRow[], exportedAt: string): string {
  const lines: string[] = ["# 個人原子知識庫", ""];
  lines.push(`匯出時間：${exportedAt}　共 ${items.length} 筆`, "");
  lines.push(PKB_USAGE_NOTICE, "", "---", "");

  if (items.length === 0) {
    lines.push("（目前沒有已同意的原子知識）");
    return lines.join("\n") + "\n";
  }

  // 依來源分類分組，模型比較容易判斷哪一段是什麼性質的內容。
  const grouped = new Map<string, PkbItemRow[]>();
  for (const item of items) {
    const key = item.source_type;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  for (const [sourceType, group] of grouped) {
    const label =
      PKB_SOURCE_TYPE_LABEL[sourceType as keyof typeof PKB_SOURCE_TYPE_LABEL];
    const selfNote = group[0].is_self_authored ? "（自製內容，非外部依據）" : "";
    lines.push(`## ${label ?? sourceType}${selfNote}`, "");

    for (const item of group) {
      const marker = item.is_self_authored ? "【自製】" : "";
      lines.push(`- ${marker}${escapeInline(item.statement)}`);
      lines.push(`  - 來源：${sourceLine(item)}`);
      if (item.tags.length > 0) {
        lines.push(`  - 標籤：${item.tags.join("、")}`);
      }
      if (item.subject && item.predicate) {
        lines.push(
          `  - 關係：${item.subject} —${item.predicate}→ ${item.object ?? "（未填）"}`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export interface PkbExportRecord {
  id: string;
  statement: string;
  source_type: string;
  source_type_label: string;
  source_label: string;
  source_url: string | null;
  source_note: string | null;
  is_self_authored: boolean;
  tags: string[];
  subject: string | null;
  predicate: string | null;
  object: string | null;
  approved_at: string | null;
}

export function toPkbRecord(item: PkbItemRow): PkbExportRecord {
  return {
    id: item.id,
    statement: item.statement,
    source_type: item.source_type,
    source_type_label: PKB_SOURCE_TYPE_LABEL[item.source_type] ?? item.source_type,
    source_label: item.source_label,
    source_url: item.source_url,
    source_note: item.source_note,
    is_self_authored: item.is_self_authored,
    tags: item.tags,
    subject: item.subject,
    predicate: item.predicate,
    object: item.object,
    approved_at: item.approved_at,
  };
}

export function toPkbJsonl(items: PkbItemRow[], exportedAt: string): string {
  // 第一行是說明，不是資料：讀取端看 kind 就知道要不要跳過。
  const header = {
    kind: "pkb-export-header",
    exported_at: exportedAt,
    count: items.length,
    usage: PKB_USAGE_NOTICE,
  };

  return (
    [header, ...items.map((item) => ({ kind: "knowledge", ...toPkbRecord(item) }))]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n"
  );
}

export function buildPkbExport(
  items: PkbItemRow[],
  format: PkbExportFormat,
  exportedAt: string,
): string {
  return format === "jsonl"
    ? toPkbJsonl(items, exportedAt)
    : toPkbMarkdown(items, exportedAt);
}
