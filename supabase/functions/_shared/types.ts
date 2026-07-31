/**
 * 文件解析的共用型別。
 *
 * 本目錄（_shared）刻意只使用 Web 標準 API，
 * 因此同一份程式碼可以同時被 Supabase Edge Function（Deno）與 Vitest 執行，
 * 不需要為兩個環境維護兩份解析邏輯。
 */

/** 解析器版本。解析規則有變動時必須調整，才能判斷舊版本是否需要重新解析。 */
export const PARSER_VERSION = "2026.07-1";

export type BlockType = "heading" | "paragraph" | "list_item" | "quote" | "code";

export interface ParsedBlock {
  /** 段落定位用的穩定編號，格式 P-001。 */
  paragraphId: string;
  /** 在文件中的順序，從 0 起算。 */
  position: number;
  blockType: BlockType;
  /** 所屬章節路徑，例如 ["風險評估", "暴露途徑"]。 */
  headingPath: string[];
  text: string;
  /** 在正規化全文中的字元起訖，供回溯原文使用。 */
  charStart: number;
  charEnd: number;
  /** 段落內容的 SHA-256，用於版本比對與增量更新。 */
  contentHash: string;
}

export interface ParsedDocument {
  title: string;
  blocks: ParsedBlock[];
  /** 正規化後的全文（各 block 以空行串接）。 */
  text: string;
  charCount: number;
  parserVersion: string;
  /** 整份文件內容的 SHA-256。 */
  contentHash: string;
}

/** 尚未編號、尚未計算雜湊的中間結果。 */
export interface RawBlock {
  blockType: BlockType;
  text: string;
  headingLevel?: number;
}

export interface VersionDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchangedCount: number;
  /** 是否有任何實質變動。 */
  hasChanges: boolean;
}
