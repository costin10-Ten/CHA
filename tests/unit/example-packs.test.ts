import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateArticlePack } from "@shared/article-pack.ts";
import { matchFacts } from "@shared/fact-matching.ts";

/**
 * public/examples/ 底下的範例檔是使用者實際會下載來改的東西。
 * 範例本身壞掉比沒有範例更糟，所以每一份都要跑過真正的驗證器。
 */

function loadExample(name: string): unknown {
  const path = join(process.cwd(), "public", "examples", name);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("最小範例 fact-pack-minimal.json", () => {
  const minimal = loadExample("fact-pack-minimal.json") as {
    source: { title: string };
    facts: { statement: string }[];
  };

  it("單獨匯入會被擋下：這個格式一定要搭配原文", () => {
    // 範例檔自己就寫著這件事，這裡確認系統真的是這樣處理，
    // 而不是默默匯入一批沒有原文可對照的原子命題。
    const result = validateArticlePack(minimal);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("沒有指定段落")),
    ).toBe(true);
  });

  it("搭配原文上傳時，三句原子命題都能對到正確的段落", () => {
    // 模擬 /import 的「原文 + 原子命題包」路徑：原文由系統解析成段落，
    // 原子命題只給敘述，段落與引句由 matchFacts 比對出來。
    const source = loadExample("fact-pack-full.json") as {
      document_chunks: { paragraph_id: string; text: string }[];
    };
    const paragraphs = source.document_chunks.map((chunk) => ({
      paragraphId: chunk.paragraph_id,
      text: chunk.text,
    }));

    const { results, summary } = matchFacts(
      minimal.facts.map((fact, index) => ({
        ref: `C00${index + 1}`,
        statement: fact.statement,
      })),
      paragraphs,
    );

    expect(results.map((item) => item.paragraphId)).toEqual([
      "P-001",
      "P-002",
      "P-003",
    ]);
    expect(summary.unmatched).toBe(0);
    expect(summary.ambiguous).toBe(0);

    // 引句由系統定位，一定是原文裡真實存在的文字，且都要人工確認。
    for (const [index, item] of results.entries()) {
      expect(item.needsReview).toBe(true);
      expect(paragraphs[index].text).toContain(item.quote);
    }
  });

  it("底線開頭的說明欄位不會變成資料", () => {
    expect(minimal.source.title).toBe("食品中的重金屬殘留標準");
    expect(minimal.facts).toHaveLength(3);
  });
});

describe("完整範例 fact-pack-full.json", () => {
  const result = validateArticlePack(loadExample("fact-pack-full.json"));

  it("通過驗證，沒有任何錯誤", () => {
    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("每一筆的引句都真的在原文裡，沒有退回整段", () => {
    expect(result.summary.quoteFallbacks).toBe(0);
    for (const candidate of result.articles[0].candidates) {
      expect(candidate.quality_flags).not.toContain("quote_not_verified");
    }
  });

  it("示範的駁回原子命題被略過，不會進資料庫", () => {
    expect(result.articles[0].droppedRejected).toEqual(["C005"]);
    expect(result.summary.rejected).toBe(1);
    expect(result.articles[0].candidates.map((candidate) => candidate.ref)).toEqual(
      ["C001", "C002", "C003", "C004"],
    );
  });

  it("中文列舉值都對得上，沒有回落成預設值", () => {
    const byRef = new Map(
      result.articles[0].candidates.map((candidate) => [candidate.ref, candidate]),
    );

    expect(byRef.get("C001")?.proposition_types).toEqual([
      "domestic_policy",
      "agency_topic",
    ]);
    expect(byRef.get("C001")?.risk_level).toBe("low");
    expect(byRef.get("C001")?.status).toBe("approved");
    expect(byRef.get("C003")?.risk_level).toBe("high");
    expect(byRef.get("C003")?.status).toBe("pending");
  });

  it("分類可複選，中文寫法一樣認得", () => {
    const byRef = new Map(
      result.articles[0].candidates.map((candidate) => [candidate.ref, candidate]),
    );

    // C003 掛兩類：毒理機制與物質性質——九類本來就會重疊。
    expect(byRef.get("C003")?.proposition_types).toEqual([
      "toxicology_mechanism",
      "substance_property",
    ]);
    // C004 用中文寫，正規化成英文識別碼。
    expect(byRef.get("C004")?.proposition_types).toEqual([
      "toxicology_mechanism",
      "substance_property",
    ]);
    // 沒有任何分類被判為無法辨識。
    expect(result.issues.filter((issue) => issue.message.includes("分類"))).toEqual(
      [],
    );
  });

  it("刪節號串接的引句可以對上原文", () => {
    const byRef = new Map(
      result.articles[0].candidates.map((candidate) => [candidate.ref, candidate]),
    );
    expect(byRef.get("C004")?.quote_fallback).toBe(false);
  });

  it("只有核定的原子命題會被寫成正式原子命題", () => {
    const refs = result.articles[0].knowledgeFacts.map(
      (fact) => fact.candidate_fact_id,
    );
    expect(refs).toEqual(["C001", "C002"]);
  });
});
