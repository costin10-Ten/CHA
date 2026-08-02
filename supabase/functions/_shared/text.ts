import type { RawBlock } from "./types.ts";

/**
 * 純文字與 Markdown 的區塊抽取。
 * 純文字只是「沒有 Markdown 記號的 Markdown」，因此共用同一條路徑。
 */
export function textToBlocks(input: string): RawBlock[] {
  const normalized = input.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  const blocks: RawBlock[] = [];
  let paragraphBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCodeFence = false;

  const flushParagraph = () => {
    const text = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ blockType: "paragraph", text });
    paragraphBuffer = [];
  };

  const flushCode = () => {
    const text = codeBuffer.join("\n").trim();
    if (text) blocks.push({ blockType: "code", text });
    codeBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^\s*```/.test(line)) {
      if (inCodeFence) {
        flushCode();
        inCodeFence = false;
      } else {
        flushParagraph();
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        blockType: "heading",
        text: heading[2].replace(/#+\s*$/, "").trim(),
        headingLevel: heading[1].length,
      });
      continue;
    }

    // setext 標題：底線為 === 或 ---
    if (/^(=|-){3,}\s*$/.test(line) && paragraphBuffer.length === 1) {
      const text = paragraphBuffer[0].trim();
      paragraphBuffer = [];
      if (text) {
        blocks.push({
          blockType: "heading",
          text,
          headingLevel: line.startsWith("=") ? 1 : 2,
        });
      }
      continue;
    }

    const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      flushParagraph();
      const text = listItem[1].trim();
      if (text) blocks.push({ blockType: "list_item", text });
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      const text = quote[1].trim();
      if (text) blocks.push({ blockType: "quote", text });
      continue;
    }

    paragraphBuffer.push(line.trim());
  }

  if (inCodeFence) flushCode();
  flushParagraph();

  return blocks.map((block) => ({
    ...block,
    text: stripInlineMarkdown(block.text),
  }));
}

/** 移除行內 Markdown 記號，讓原子命題抽取讀到的是乾淨句子。 */
export function stripInlineMarkdown(input: string): string {
  return input
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** 從內容推測標題：第一個標題區塊，否則第一段的前 60 字。 */
export function inferTitle(blocks: RawBlock[], fallback: string): string {
  const heading = blocks.find((block) => block.blockType === "heading");
  if (heading?.text) return heading.text;

  const first = blocks.find((block) => block.text.length > 0);
  if (first) {
    const text = first.text.trim();
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }

  return fallback;
}
