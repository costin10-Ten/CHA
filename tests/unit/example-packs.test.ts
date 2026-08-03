import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateArticlePack } from "@shared/article-pack.ts";
import { validatePkbPack } from "@shared/pkb-pack.ts";
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

/**
 * 個人原子知識庫的範例。
 *
 * 這兩個檔案同時是 /pkb/import 頁面上顯示的程式碼區塊與下載按鈕的內容，
 * 所以它們必須真的匯得進去——照著範例寫卻匯不進來是最糟的狀況。
 */
describe("PKB 最小範例 pkb-minimal.json", () => {
  const result = validatePkbPack(loadExample("pkb-minimal.json"));

  it("通過驗證，兩筆都沿用整包的來源", () => {
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.source_label).toBe("環境荷爾蒙怎麼讓我內分泌失調的？");
      expect(item.source_type).toBe("popular_science");
    }
  });

  it("沒有任何錯誤或警告——最小範例不該讓人一開始就看到紅字", () => {
    expect(result.issues).toEqual([]);
  });

  it("底線開頭的說明欄位不會變成資料", () => {
    expect(result.items.some((item) => item.statement.startsWith("最小可用"))).toBe(
      false,
    );
  });
});

describe("PKB 完整範例 pkb-full.json", () => {
  const result = validatePkbPack(loadExample("pkb-full.json"));

  it("五筆匯入、一筆駁回略過", () => {
    expect(result.ok).toBe(true);
    expect(result.summary.items).toBe(5);
    expect(result.summary.rejected).toBe(1);
    expect(result.summary.skipped).toBe(0);
    expect(result.items.map((item) => item.ref)).toEqual([
      "K001",
      "K002",
      "K003",
      "K004",
      "K006",
    ]);
  });

  it("示範了整包沿用與逐筆覆寫兩種寫法", () => {
    const byRef = new Map(result.items.map((item) => [item.ref, item]));
    // 沿用整包
    expect(byRef.get("K001")?.source_label).toBe("化學物質登錄辦法");
    expect(byRef.get("K002")?.source_type).toBe("domestic_law");
    // 逐筆覆寫
    expect(byRef.get("K003")?.source_label).toBe("自己出的模擬題");
    expect(byRef.get("K003")?.source_type).toBe("mock_question");
  });

  it("兩筆自製內容被標記", () => {
    expect(result.summary.selfAuthored).toBe(2);
  });

  it("標示同意的那筆有被辨識出來，供勾選沿用時使用", () => {
    const k006 = result.items.find((item) => item.ref === "K006");
    expect(k006?.approved_in_pack).toBe(true);
    expect(result.summary.approvedInPack).toBe(1);
  });

  it("K001 的圖譜欄位完整", () => {
    const k001 = result.items.find((item) => item.ref === "K001");
    expect(k001?.subject).toBe("化學物質登錄制度");
    expect(k001?.predicate).toBe("主管機關");
    expect(k001?.object).toBe("環境部化學物質管理署");
  });

  it("除了「略過駁回」之外沒有其他提醒", () => {
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain("略過 1 筆");
  });
});
