import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateArticlePack } from "@shared/article-pack.ts";

/**
 * data/ 底下放的是實際要匯入的原子命題包。
 *
 * 存進版本控制卻匯不進去是最糟的狀態——看起來是好的，用的時候才爆。
 * 所以每一份都要跑過真正的驗證器。
 */

const ROOT = join(process.cwd(), "data", "environmental-hormone");

function load(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(ROOT, ...segments), "utf8"));
}

describe("環境荷爾蒙：可匯入的那一份", () => {
  const result = validateArticlePack(load("moenv-endocrine-intro.json"));

  it("零錯誤零警告", () => {
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("44 筆原子命題，全部對到本文的六段原文", () => {
    expect(result.summary.candidates).toBe(44);
    expect(result.summary.chunks).toBe(6);
    expect(result.summary.skipped).toBe(0);

    const paragraphs = new Set(
      result.articles[0].chunks.map((chunk) => chunk.paragraph_id),
    );
    for (const candidate of result.articles[0].candidates) {
      expect(paragraphs.has(candidate.source_paragraph_id)).toBe(true);
    }
  });

  it("每一筆的引句都真的在原文裡，沒有退回整段", () => {
    expect(result.summary.quoteFallbacks).toBe(0);
    for (const candidate of result.articles[0].candidates) {
      expect(candidate.quality_flags).not.toContain("quote_not_verified");
    }
  });

  it("沒有駁回的項目混進來", () => {
    expect(result.summary.rejected).toBe(0);
    expect(result.articles[0].droppedRejected).toEqual([]);
  });

  it("每一筆都有分類", () => {
    for (const candidate of result.articles[0].candidates) {
      expect(candidate.proposition_types.length).toBeGreaterThan(0);
    }
  });
});

describe("環境荷爾蒙：待補來源的分組", () => {
  const files = readdirSync(join(ROOT, "pending-sources")).filter((name) =>
    name.endsWith(".json"),
  );

  it("15 組，合計 33 筆，編號不重複", () => {
    expect(files).toHaveLength(15);

    const refs: string[] = [];
    for (const file of files) {
      const pack = load("pending-sources", file) as {
        facts: { ref: string }[];
      };
      refs.push(...pack.facts.map((fact) => fact.ref));
    }

    expect(refs).toHaveLength(33);
    expect(new Set(refs).size).toBe(33);
  });

  it("每一組都指出自己的來源文件與網址", () => {
    for (const file of files) {
      const pack = load("pending-sources", file) as {
        _來源文件?: { url?: string }[];
        source?: { url?: string | null };
      };
      expect(pack._來源文件?.length, file).toBeGreaterThan(0);
      expect(pack.source?.url, file).toMatch(/^https?:\/\//);
    }
  });

  it("這些不會被誤當成可匯入的包：沒有原文就是匯不進去", () => {
    // 它們刻意不帶 document_chunks——原文要另外匯入。
    // 這裡確認驗證器會擋下來，而不是默默收進去。
    for (const file of files) {
      const result = validateArticlePack(load("pending-sources", file));
      expect(result.ok, file).toBe(false);
      expect(
        result.issues.some((issue) => issue.message.includes("沒有指定段落")),
        file,
      ).toBe(true);
    }
  });
});

describe("環境荷爾蒙：駁回紀錄", () => {
  it("13 筆，只留檔不匯入", () => {
    const pack = load("rejected.json") as { facts: { status: string }[] };
    expect(pack.facts).toHaveLength(13);
    for (const fact of pack.facts) {
      expect(fact.status).toBe("駁回");
    }
  });

  it("就算有人誤把它丟進 /import 也不會有東西進資料庫", () => {
    const result = validateArticlePack(load("rejected.json"));
    expect(result.ok).toBe(false);
    expect(result.summary.candidates).toBe(0);
  });
});
