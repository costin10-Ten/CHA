import { contentHash } from "./hash.ts";
import { extractHtmlTitle, htmlToBlocks } from "./html.ts";
import { inferTitle, textToBlocks } from "./text.ts";
import {
  PARSER_VERSION,
  type ParsedBlock,
  type ParsedDocument,
  type RawBlock,
} from "./types.ts";

export type ParseKind = "text" | "markdown" | "html" | "pdf";

export interface ParseInput {
  kind: ParseKind;
  /** 原始內容；PDF 請先抽出文字後以 kind = "pdf" 傳入。 */
  raw: string;
  /** 使用者指定的標題，優先於自動推測。 */
  title?: string;
  /** 自動推測失敗時的備援標題。 */
  fallbackTitle?: string;
}

/** 段落編號：P-001、P-002…（超過 999 自動加長）。 */
export function formatParagraphId(index: number): string {
  return `P-${String(index + 1).padStart(3, "0")}`;
}

/** 依標題階層推算每個區塊所屬的章節路徑。 */
function buildHeadingPaths(blocks: RawBlock[]): string[][] {
  const stack: { level: number; text: string }[] = [];
  return blocks.map((block) => {
    if (block.blockType === "heading") {
      const level = block.headingLevel ?? 1;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const path = stack.map((item) => item.text);
      stack.push({ level, text: block.text });
      return path;
    }
    return stack.map((item) => item.text);
  });
}

export async function parseDocument(input: ParseInput): Promise<ParsedDocument> {
  const rawBlocks =
    input.kind === "html" ? htmlToBlocks(input.raw) : textToBlocks(input.raw);

  const headingPaths = buildHeadingPaths(rawBlocks);

  const blocks: ParsedBlock[] = [];
  let cursor = 0;
  const textParts: string[] = [];

  for (let index = 0; index < rawBlocks.length; index += 1) {
    const raw = rawBlocks[index];
    const charStart = cursor;
    const charEnd = charStart + raw.text.length;

    blocks.push({
      paragraphId: formatParagraphId(index),
      position: index,
      blockType: raw.blockType,
      headingPath: headingPaths[index],
      text: raw.text,
      charStart,
      charEnd,
      contentHash: await contentHash(raw.text),
    });

    textParts.push(raw.text);
    cursor = charEnd + 2; // 各區塊以空行串接
  }

  const text = textParts.join("\n\n");

  const title =
    input.title?.trim() ||
    (input.kind === "html" ? extractHtmlTitle(input.raw) : "") ||
    inferTitle(rawBlocks, input.fallbackTitle ?? "未命名文件");

  return {
    title,
    blocks,
    text,
    charCount: text.length,
    parserVersion: PARSER_VERSION,
    contentHash: await contentHash(text),
  };
}

/** 依副檔名與 MIME 判斷解析方式。 */
export function detectParseKind(
  fileName: string | null,
  mimeType: string | null,
): ParseKind {
  const name = (fileName ?? "").toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();

  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) {
    return "html";
  }
  if (
    mime.includes("markdown") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return "markdown";
  }
  return "text";
}
