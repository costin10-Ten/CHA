// @vitest-environment node
import { describe, expect, it } from "vitest";

import { contentHash, normalizeForHash } from "@shared/hash.ts";
import { decodeEntities, extractHtmlTitle, htmlToBlocks } from "@shared/html.ts";
import {
  detectParseKind,
  formatParagraphId,
  parseDocument,
} from "@shared/parse.ts";
import { inferTitle, stripInlineMarkdown, textToBlocks } from "@shared/text.ts";
import { PARSER_VERSION } from "@shared/types.ts";

describe("normalizeForHash", () => {
  it("忽略換行樣式與行尾空白差異", () => {
    expect(normalizeForHash("一\r\n二  \n")).toBe(normalizeForHash("一\n二"));
  });

  it("壓縮三行以上的空行", () => {
    expect(normalizeForHash("一\n\n\n\n二")).toBe("一\n\n二");
  });
});

describe("contentHash", () => {
  it("同樣內容得到同樣雜湊", async () => {
    const a = await contentHash("氫氟酸具有腐蝕性。");
    const b = await contentHash("氫氟酸具有腐蝕性。 ");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("內容不同則雜湊不同", async () => {
    expect(await contentHash("汞")).not.toBe(await contentHash("蘇丹紅"));
  });
});

describe("formatParagraphId", () => {
  it("從 P-001 開始編號", () => {
    expect(formatParagraphId(0)).toBe("P-001");
    expect(formatParagraphId(11)).toBe("P-012");
    expect(formatParagraphId(1234)).toBe("P-1235");
  });
});

describe("textToBlocks", () => {
  it("辨識標題、段落、清單與引言", () => {
    const blocks = textToBlocks(
      [
        "# 氫氟酸",
        "",
        "氫氟酸是氟化氫的水溶液。",
        "接觸皮膚可能造成深層灼傷。",
        "",
        "## 急救",
        "- 立即以大量清水沖洗",
        "1. 儘速就醫",
        "",
        "> 本資料僅供參考",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.blockType)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list_item",
      "list_item",
      "quote",
    ]);
    expect(blocks[1].text).toBe(
      "氫氟酸是氟化氫的水溶液。 接觸皮膚可能造成深層灼傷。",
    );
    expect(blocks[0].headingLevel).toBe(1);
    expect(blocks[2].headingLevel).toBe(2);
  });

  it("以空行分段", () => {
    const blocks = textToBlocks("第一段。\n\n第二段。");
    expect(blocks).toHaveLength(2);
    expect(blocks[1].text).toBe("第二段。");
  });

  it("保留程式碼區塊的換行", () => {
    const blocks = textToBlocks("```\nline1\nline2\n```");
    expect(blocks[0].blockType).toBe("code");
  });
});

describe("stripInlineMarkdown", () => {
  it("移除連結、粗體與行內程式碼記號", () => {
    expect(stripInlineMarkdown("**重要**：見 [來源](https://a.b) 與 `pH` 值")).toBe(
      "重要：見 來源 與 pH 值",
    );
  });
});

describe("htmlToBlocks", () => {
  const html = `
    <html>
      <head><title>汞的健康風險</title><style>.x{color:red}</style></head>
      <body>
        <nav><a href="/">首頁</a><a href="/about">關於</a></nav>
        <div class="ad-banner">立即購買，限時優惠，錯過不再</div>
        <article>
          <h1>汞的健康風險</h1>
          <p>甲基汞可經由食物鏈累積於大型魚類。</p>
          <h2>建議攝取</h2>
          <ul><li>孕婦每週不超過兩份</li></ul>
          <blockquote>資料來源：示範文字</blockquote>
        </article>
        <footer>版權所有</footer>
        <script>console.log("x")</script>
      </body>
    </html>`;

  it("取出標題", () => {
    expect(extractHtmlTitle(html)).toBe("汞的健康風險");
  });

  it("清除導覽列、頁尾、廣告與指令碼", () => {
    const texts = htmlToBlocks(html).map((block) => block.text);
    expect(texts.join(" ")).not.toContain("首頁");
    expect(texts.join(" ")).not.toContain("版權所有");
    expect(texts.join(" ")).not.toContain("限時優惠");
    expect(texts.join(" ")).not.toContain("console.log");
  });

  it("保留內文順序與區塊型別", () => {
    const blocks = htmlToBlocks(html);
    expect(blocks.map((block) => block.blockType)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list_item",
      "quote",
    ]);
    expect(blocks[1].text).toBe("甲基汞可經由食物鏈累積於大型魚類。");
  });

  it("解碼 HTML 實體", () => {
    expect(decodeEntities("5&nbsp;&micro;g&#47;L &amp; more")).toBe(
      "5 µg/L & more",
    );
  });
});

describe("parseDocument", () => {
  it("為每個段落編號並計算雜湊與定位", async () => {
    const parsed = await parseDocument({
      kind: "markdown",
      raw: "# 蘇丹紅\n\n蘇丹紅是工業染料。\n\n## 法規\n\n我國禁止用於食品。",
    });

    expect(parsed.title).toBe("蘇丹紅");
    expect(parsed.parserVersion).toBe(PARSER_VERSION);
    expect(parsed.blocks.map((block) => block.paragraphId)).toEqual([
      "P-001",
      "P-002",
      "P-003",
      "P-004",
    ]);
    expect(parsed.blocks[3].headingPath).toEqual(["蘇丹紅", "法規"]);
    expect(parsed.blocks[1].headingPath).toEqual(["蘇丹紅"]);
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.charCount).toBe(parsed.text.length);

    // charStart/charEnd 必須真的指向全文中的該段文字。
    for (const block of parsed.blocks) {
      expect(parsed.text.slice(block.charStart, block.charEnd)).toBe(block.text);
    }
  });

  it("使用者指定標題優先", async () => {
    const parsed = await parseDocument({
      kind: "text",
      raw: "第一段內容。",
      title: "自訂標題",
    });
    expect(parsed.title).toBe("自訂標題");
  });

  it("HTML 以頁面標題為主", async () => {
    const parsed = await parseDocument({
      kind: "html",
      raw: "<title>頁面標題</title><body><p>內容段落文字。</p></body>",
    });
    expect(parsed.title).toBe("頁面標題");
  });

  it("內容相同的兩次解析得到相同雜湊", async () => {
    const a = await parseDocument({ kind: "text", raw: "一樣的內容。" });
    const b = await parseDocument({ kind: "text", raw: "一樣的內容。\n" });
    expect(a.contentHash).toBe(b.contentHash);
  });
});

describe("inferTitle", () => {
  it("沒有標題時取第一段前 60 字", () => {
    const blocks = textToBlocks("這是一段沒有標題的文字。");
    expect(inferTitle(blocks, "備援")).toBe("這是一段沒有標題的文字。");
  });

  it("完全沒有內容時使用備援標題", () => {
    expect(inferTitle([], "備援")).toBe("備援");
  });
});

describe("detectParseKind", () => {
  it.each([
    ["report.pdf", "application/pdf", "pdf"],
    ["page.html", "text/html", "html"],
    ["notes.md", "application/octet-stream", "markdown"],
    ["notes.txt", "text/plain", "text"],
    [null, null, "text"],
  ])("%s → %s", (name, mime, expected) => {
    expect(detectParseKind(name, mime)).toBe(expected);
  });
});
