import type { RawBlock } from "./types.ts";

/**
 * 網頁清理與區塊抽取。
 *
 * 目標（工作單第 7 節）：
 * - 清除導覽列、頁尾與廣告
 * - 保留標題、章節與段落順序
 *
 * 這裡用純字串處理而非 DOM parser，因為同一份程式碼要能在 Deno Edge Function
 * 與測試環境執行，且不引入額外相依套件。
 */

/** 內容完全捨棄的元素。 */
const DROP_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "form",
  "button",
  "select",
  "nav",
  "header",
  "footer",
  "aside",
  "menu",
  "dialog",
];

/** class／id 命中這些關鍵字的容器視為非內文。 */
const NOISE_PATTERN =
  /(^|[-_ ])(nav|navbar|menu|sidebar|side-bar|footer|header|masthead|advert|ads?|ad-slot|banner|cookie|consent|popup|modal|share|social|subscribe|newsletter|related|recommend|breadcrumb|pagination|comment|comments|toolbar|widget|promo|sponsor)([-_ ]|$)/i;

const BLOCK_TAG_PATTERN =
  /<(h[1-6]|p|li|blockquote|pre|dd|dt|figcaption|td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  times: "×",
  deg: "°",
  micro: "µ",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const value = ENTITIES[name.toLowerCase()];
      return value ?? match;
    });
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** 移除註解與整段捨棄的元素（含未正確關閉的情況）。 */
function removeDroppedElements(html: string): string {
  let output = html.replace(/<!--[\s\S]*?-->/g, "");

  for (const tag of DROP_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    output = output.replace(paired, " ");
    // 殘留的開頭標籤（未閉合）直接移除，避免內容被吃掉。
    output = output.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), " ");
  }

  return output;
}

/** 移除 class／id 看起來像導覽、廣告、留言區的 div/section 容器。 */
function removeNoisyContainers(html: string): string {
  const containerPattern =
    /<(div|section|ul|ol|table)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

  let previous = html;
  // 巢狀容器需要重複掃描，最多三輪即可收斂，避免無限迴圈。
  for (let round = 0; round < 3; round += 1) {
    const next = previous.replace(
      containerPattern,
      (match: string, _tag: string, attrs: string) => {
        const classMatch =
          /\b(?:class|id|role|data-testid)\s*=\s*["']([^"']*)["']/gi;
        let hit: RegExpExecArray | null;
        while ((hit = classMatch.exec(attrs)) !== null) {
          if (NOISE_PATTERN.test(hit[1])) return " ";
        }
        return match;
      },
    );
    if (next === previous) break;
    previous = next;
  }

  return previous;
}

/** 若頁面有 <article> 或 <main>，只取其內容以避免周邊區塊。 */
function selectMainContent(html: string): string {
  for (const tag of ["article", "main"]) {
    const match = new RegExp(
      `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,
      "i",
    ).exec(html);
    if (match && stripTags(match[1]).length > 200) {
      return match[1];
    }
  }
  return html;
}

export function extractHtmlTitle(html: string): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (title) {
    const text = stripTags(title[1]);
    if (text) return text;
  }

  const ogTitle =
    /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(
      html,
    );
  if (ogTitle) {
    const text = decodeEntities(ogTitle[1]).trim();
    if (text) return text;
  }

  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html);
  if (h1) {
    const text = stripTags(h1[1]);
    if (text) return text;
  }

  return "";
}

/**
 * 把 HTML 轉成有序的區塊清單，保留標題階層與段落順序。
 */
export function htmlToBlocks(html: string): RawBlock[] {
  const cleaned = removeNoisyContainers(
    removeDroppedElements(selectMainContent(removeDroppedElements(html))),
  );

  const blocks: RawBlock[] = [];
  const seen = new Set<string>();

  for (const match of cleaned.matchAll(BLOCK_TAG_PATTERN)) {
    const tag = match[1].toLowerCase();
    const inner = match[3];

    // 巢狀 block（例如 <li> 內含 <p>）在外層已被涵蓋，內層仍會被獨立比對到，
    // 以文字內容去重即可。
    const text = stripTags(inner);
    if (!text || text.length < 2) continue;

    const key = `${tag}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (/^h[1-6]$/.test(tag)) {
      blocks.push({
        blockType: "heading",
        text,
        headingLevel: Number.parseInt(tag.slice(1), 10),
      });
    } else if (tag === "li" || tag === "dd" || tag === "dt") {
      blocks.push({ blockType: "list_item", text });
    } else if (tag === "blockquote") {
      blocks.push({ blockType: "quote", text });
    } else if (tag === "pre") {
      blocks.push({ blockType: "code", text });
    } else {
      blocks.push({ blockType: "paragraph", text });
    }
  }

  return dropDuplicateNestedText(blocks);
}

/**
 * 外層容器（例如 <td> 內含 <p>）會產生「父段落包含子段落全文」的重複，
 * 這裡移除被其他段落完整包含的較短重複項。
 */
function dropDuplicateNestedText(blocks: RawBlock[]): RawBlock[] {
  const texts = blocks.map((block) => block.text);
  return blocks.filter((block, index) => {
    if (block.blockType === "heading") return true;
    return !texts.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.length > block.text.length &&
        other.includes(block.text),
    );
  });
}
