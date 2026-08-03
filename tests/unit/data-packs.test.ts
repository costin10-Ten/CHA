import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateArticlePack } from "@shared/article-pack.ts";
import { validatePkbPack } from "@shared/pkb-pack.ts";

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

/**
 * 個人原子知識庫的上線驗證包。
 *
 * 這一份是要真的匯進資料庫走完流程的，所以它自己得先是對的——
 * 檔案裡寫的預期結果與驗證器的實際輸出必須一致，否則驗證會白做。
 */
describe("PKB 上線驗證包", () => {
  const pack = JSON.parse(
    readFileSync(join(process.cwd(), "data", "pkb-smoke-test.json"), "utf8"),
  );
  const result = validatePkbPack(pack);

  it("四筆可匯入、一筆駁回被略過，與檔案裡寫的預期一致", () => {
    expect(result.ok).toBe(true);
    expect(result.summary.items).toBe(4);
    expect(result.summary.rejected).toBe(1);
    expect(result.summary.skipped).toBe(0);
    expect(result.items.map((item) => item.ref)).toEqual([
      "K001",
      "K002",
      "K003",
      "K004",
    ]);
  });

  it("整包的來源會被沒寫來源的那兩筆沿用", () => {
    const byRef = new Map(result.items.map((item) => [item.ref, item]));
    for (const ref of ["K001", "K002"]) {
      expect(byRef.get(ref)?.source_label, ref).toBe("化學物質登錄制度簡介");
      expect(byRef.get(ref)?.source_type, ref).toBe("domestic_law");
    }
  });

  it("兩筆自製內容有被標記，兩筆外部來源沒有", () => {
    const byRef = new Map(result.items.map((item) => [item.ref, item]));
    expect(byRef.get("K003")?.is_self_authored).toBe(true);
    expect(byRef.get("K004")?.is_self_authored).toBe(true);
    expect(byRef.get("K001")?.is_self_authored).toBe(false);
    expect(byRef.get("K002")?.is_self_authored).toBe(false);
    expect(result.summary.selfAuthored).toBe(2);
  });

  it("K001 帶完整的主客關係，同意後才建得出圖譜", () => {
    const k001 = result.items.find((item) => item.ref === "K001");
    expect(k001?.subject).toBe("化學物質登錄制度");
    expect(k001?.predicate).toBe("主管機關");
    expect(k001?.object).toBe("環境部化學物質管理署");
  });

  it("沒有任何一筆被誤判需要跳過", () => {
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
  });
});
