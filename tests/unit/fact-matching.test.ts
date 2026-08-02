import { describe, expect, it } from "vitest";

import {
  MATCH_THRESHOLD,
  locateQuote,
  matchFact,
  matchFacts,
  splitParagraphSentences,
} from "@shared/fact-matching.ts";

import { DEMO_ARTICLES } from "@/lib/demo/articles";

/**
 * 原子命題 ↔ 原文段落的比對。
 *
 * 這是「原文另外上傳」這條路徑的核心：原子命題包不必自帶原文，
 * 系統用內容找出每一筆原子命題屬於哪一段，並從段落裡定位出引句。
 * 系統可以「找出」引句，但絕不「編寫」引句——測試會檢查回傳的引句
 * 一定是原文裡真實存在的文字。
 */

const PARAGRAPHS = [
  {
    paragraphId: "P-001",
    text: "氫氟酸是氟化氫溶於水形成的溶液，在半導體製造與玻璃蝕刻等工業製程中使用。它的腐蝕性與一般強酸不同：低濃度接觸皮膚時，初期可能沒有明顯疼痛。",
  },
  {
    paragraphId: "P-002",
    text: "氟離子可以穿透皮膚，並與體內的鈣離子及鎂離子結合，造成組織深層損傷。大面積或高濃度暴露時，可能導致血鈣濃度下降。",
  },
  {
    paragraphId: "P-003",
    text: "皮膚接觸氫氟酸後，應立即以大量清水沖洗，並儘速就醫。眼睛接觸時應持續沖洗並立即送醫。",
  },
];

describe("引句直接命中原文", () => {
  it("找得到就照用，不需要人工再確認", () => {
    const result = matchFact(
      {
        ref: "C001",
        statement: "氟離子可以穿透皮膚。",
        quote: "氟離子可以穿透皮膚",
      },
      PARAGRAPHS,
    );

    expect(result.method).toBe("quote");
    expect(result.paragraphId).toBe("P-002");
    expect(result.quote).toBe("氟離子可以穿透皮膚");
    expect(result.needsReview).toBe(false);
  });

  it("段落編號寫錯也不影響：以引句實際出現的位置為準", () => {
    const result = matchFact(
      {
        ref: "C001",
        statement: "氟離子可以穿透皮膚。",
        quote: "氟離子可以穿透皮膚",
        paragraphIdHint: "P-099",
      },
      PARAGRAPHS,
    );

    expect(result.paragraphId).toBe("P-002");
    expect(result.method).toBe("quote");
  });
});

describe("以敘述內容比對", () => {
  it("引句是佔位符時，仍能找出正確段落並定位引句", () => {
    const result = matchFact(
      {
        ref: "C001",
        statement: "皮膚接觸氫氟酸後，應立即以大量清水沖洗，並儘速就醫。",
        quote: "$resolve_quote(P-003,C001)",
        paragraphIdHint: "P-003",
      },
      PARAGRAPHS,
    );

    expect(result.method).toBe("statement");
    expect(result.paragraphId).toBe("P-003");
    expect(result.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(result.needsReview).toBe(true);
  });

  it("完全沒有引句也能比對", () => {
    const result = matchFact(
      {
        ref: "C001",
        statement: "大面積或高濃度暴露時，可能導致血鈣濃度下降。",
      },
      PARAGRAPHS,
    );

    expect(result.paragraphId).toBe("P-002");
    expect(result.needsReview).toBe(true);
  });

  it("定位出來的引句一定是原文裡真實存在的文字", () => {
    for (const statement of [
      "皮膚接觸氫氟酸後，應立即以大量清水沖洗，並儘速就醫。",
      "大面積或高濃度暴露時，可能導致血鈣濃度下降。",
      "氫氟酸在半導體製造與玻璃蝕刻等工業製程中使用。",
    ]) {
      const result = matchFact({ ref: "C", statement }, PARAGRAPHS);
      const paragraph = PARAGRAPHS.find(
        (item) => item.paragraphId === result.paragraphId,
      );

      expect(paragraph, statement).toBeDefined();
      expect(paragraph!.text.includes(result.quote!), statement).toBe(true);
    }
  });

  it("引句比整段短，才有定位的意義", () => {
    const result = matchFact(
      {
        ref: "C001",
        statement: "眼睛接觸時應持續沖洗並立即送醫。",
      },
      PARAGRAPHS,
    );

    expect(result.paragraphId).toBe("P-003");
    expect(result.quote!.length).toBeLessThan(PARAGRAPHS[2].text.length);
    expect(result.quote).toContain("眼睛接觸");
  });
});

describe("段落編號提示", () => {
  it("內容重疊度不足但編號存在時，仍可對應並標記需確認", () => {
    const paragraphs = [
      { paragraphId: "P-001", text: "完全無關的內容，講的是天氣與交通。" },
      { paragraphId: "P-007", text: "本節說明相關的管理規定與適用範圍。" },
    ];

    const result = matchFact(
      {
        ref: "C001",
        statement: "適用範圍涵蓋相關的管理規定。",
        paragraphIdHint: "P-007",
      },
      paragraphs,
    );

    expect(result.paragraphId).toBe("P-007");
    expect(result.needsReview).toBe(true);
  });
});

describe("找不到對應", () => {
  it("內容完全不相關時不強行對應", () => {
    const result = matchFact(
      {
        ref: "C001",
        statement: "颱風季節出門記得帶傘，並注意路面積水。",
      },
      PARAGRAPHS,
    );

    expect(result.method).toBe("none");
    expect(result.paragraphId).toBeNull();
    expect(result.quote).toBeNull();
  });

  it("沒有任何段落時回傳未對應", () => {
    const result = matchFact({ ref: "C001", statement: "任何內容" }, []);
    expect(result.method).toBe("none");
  });
});

describe("批次比對統計", () => {
  it("分別統計三種對應方式與未對應筆數", () => {
    const { summary } = matchFacts(
      [
        {
          ref: "C001",
          statement: "氟離子可以穿透皮膚。",
          quote: "氟離子可以穿透皮膚",
        },
        {
          ref: "C002",
          statement: "皮膚接觸氫氟酸後，應立即以大量清水沖洗，並儘速就醫。",
          quote: "$resolve_quote(P-003,C002)",
        },
        {
          ref: "C003",
          statement: "颱風季節出門記得帶傘。",
        },
      ],
      PARAGRAPHS,
    );

    expect(summary.byQuote).toBe(1);
    expect(summary.byStatement).toBe(1);
    expect(summary.unmatched).toBe(1);
  });
});

describe("句子切分與引句定位", () => {
  it("依句末標點切句", () => {
    expect(splitParagraphSentences("甲。乙！丙？丁")).toEqual([
      "甲。",
      "乙！",
      "丙？",
      "丁",
    ]);
  });

  it("單句段落直接回傳整段", () => {
    expect(locateQuote("任何敘述", "只有一句話的段落")).toBe("只有一句話的段落");
  });

  it("找不到相近句子時回傳整段，不會編造", () => {
    const paragraph = "甲乙丙。丁戊己。";
    const quote = locateQuote("完全無關的內容", paragraph);
    expect(paragraph.includes(quote)).toBe(true);
  });
});

describe("以示範資料量測準確率", () => {
  it.each(DEMO_ARTICLES.map((article) => [article.title, article] as const))(
    "%s：忠實反映原文的敘述都對到正確段落，且沒有任何一筆對錯段落",
    (_title, article) => {
      const paragraphs = article.paragraphs.map((paragraph) => ({
        paragraphId: paragraph.paragraph_id,
        text: paragraph.text,
      }));

      // 模擬「原子命題包只有敘述、沒有引句」的情況。
      const facts = article.candidates.map((candidate) => ({
        ref: candidate.ref,
        statement: candidate.statement,
        paragraphIdHint: candidate.source_paragraph_id,
      }));

      const { results } = matchFacts(facts, paragraphs);

      const wrong = results.filter((result, index) => {
        const truth = article.candidates[index].source_paragraph_id;
        return result.paragraphId !== null && result.paragraphId !== truth;
      });

      // 寧可回報「找不到」也不要把原子命題掛到錯的段落上。
      expect(
        wrong.map((item) => `${item.ref} → ${item.paragraphId}`).join("、"),
      ).toBe("");

      // 未經扭曲的原子命題（核定與待審核）都要對得上。
      const genuine = results.filter((_, index) =>
        ["approved", "pending"].includes(article.candidates[index].status),
      );
      expect(genuine.every((item) => item.paragraphId !== null)).toBe(true);
    },
  );

  it("被扭曲、超出原文的敘述會找不到對應，而不是硬掛上去", () => {
    const article = DEMO_ARTICLES[0];
    const paragraphs = article.paragraphs.map((paragraph) => ({
      paragraphId: paragraph.paragraph_id,
      text: paragraph.text,
    }));

    // 示範資料裡刻意寫壞的那一筆：原文只說「部分清潔劑含氟化物成分」。
    const distorted = article.candidates.find(
      (candidate) =>
        candidate.statement === "家用清潔劑都含有氫氟酸，使用時非常危險。",
    )!;

    const result = matchFact(
      { ref: distorted.ref, statement: distorted.statement },
      paragraphs,
    );

    expect(result.method).toBe("none");
  });
});
