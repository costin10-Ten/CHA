// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  PARTIAL_THRESHOLD,
  SUPPORT_THRESHOLD,
  buildPublishableAnswer,
  coverage,
  stripCitations,
  summarize,
  verifyAnswerSentences,
  verifySentence,
  type VerificationFact,
} from "@shared/verification.ts";

const FACTS: VerificationFact[] = [
  {
    knowledgeId: "K-0001",
    factId: "11111111-1111-1111-1111-111111111111",
    statement: "甲基汞可經由食物鏈累積於大型魚類。",
    conditions: {},
  },
  {
    knowledgeId: "K-0002",
    factId: "22222222-2222-2222-2222-222222222222",
    statement: "孕婦每週攝取大型魚類不應超過 2 份。",
    conditions: { population: "孕婦" },
  },
  {
    knowledgeId: "K-0003",
    factId: "33333333-3333-3333-3333-333333333333",
    statement: "長期攝取甲基汞可能影響胎兒神經發育。",
    conditions: { population: "胎兒" },
  },
];

describe("stripCitations", () => {
  it("移除知識編號標記", () => {
    expect(stripCitations("甲基汞會累積 [K-0001]。")).toBe("甲基汞會累積 。");
  });
});

describe("coverage", () => {
  it("完全相同時為 1", () => {
    expect(coverage("甲基汞會累積於大型魚類。", "甲基汞會累積於大型魚類。")).toBe(
      1,
    );
  });

  it("完全無關時接近 0", () => {
    expect(
      coverage("颱風假由地方政府宣布。", "甲基汞會累積於大型魚類。"),
    ).toBeLessThan(0.2);
  });

  it("門檻設定合理：支持高於部分支持", () => {
    expect(SUPPORT_THRESHOLD).toBeGreaterThan(PARTIAL_THRESHOLD);
  });
});

describe("verifySentence 綠燈", () => {
  it("直接引用且內容一致時判為 supported", () => {
    const result = verifySentence(
      "甲基汞可經由食物鏈累積於大型魚類。[K-0001]",
      FACTS,
    );

    expect(result.verdict).toBe("supported");
    expect(result.supportingRefs).toContain("K-0001");
    expect(result.supportingFactIds).toContain(FACTS[0].factId);
    expect(result.reasons).toEqual([]);
  });

  it("數字一致時仍是 supported", () => {
    const result = verifySentence(
      "孕婦每週攝取大型魚類不應超過 2 份。[K-0002]",
      FACTS,
    );
    expect(result.verdict).toBe("supported");
  });

  it("資料不足的說明不算事實主張", () => {
    const result = verifySentence("現有核定事實不足以回答這個問題。", FACTS);
    expect(result.verdict).toBe("supported");
    expect(result.reasons[0]).toContain("不是事實陳述");
  });
});

describe("verifySentence 紅燈", () => {
  it("完全找不到支持的事實", () => {
    const result = verifySentence("颱風假由地方政府各自宣布。", FACTS);
    expect(result.verdict).toBe("unsupported");
    expect(result.reasons.join()).toContain("找不到");
  });

  it("數字與核定事實不符", () => {
    const result = verifySentence(
      "孕婦每週攝取大型魚類不應超過 5 份。[K-0002]",
      FACTS,
    );
    expect(result.verdict).toBe("unsupported");
    expect(result.reasons.join()).toContain("數字");
  });

  it("否定語氣與事實相反", () => {
    const result = verifySentence(
      "甲基汞不會經由食物鏈累積於大型魚類。[K-0001]",
      FACTS,
    );
    expect(result.verdict).toBe("unsupported");
    expect(result.reasons.join()).toContain("否定");
  });

  it("引用了證據包以外的編號", () => {
    const result = verifySentence(
      "甲基汞可經由食物鏈累積於大型魚類。[K-0009]",
      FACTS,
    );
    expect(result.verdict).toBe("unsupported");
    expect(result.reasons.join()).toContain("證據包以外");
  });

  it("沒有任何證據時一律判紅", () => {
    const result = verifySentence("任何句子都一樣。", []);
    expect(result.verdict).toBe("unsupported");
  });
});

describe("verifySentence 黃燈", () => {
  it("事實有不確定語氣但回答寫成確定", () => {
    const result = verifySentence(
      "長期攝取甲基汞會影響胎兒神經發育。[K-0003]",
      FACTS,
    );
    expect(result.verdict).toBe("partial");
    expect(result.reasons.join()).toContain("不確定語氣");
  });

  it("事實有適用條件但回答沒帶出來", () => {
    const result = verifySentence("每週攝取大型魚類不應超過 2 份。[K-0002]", [
      {
        ...FACTS[1],
        statement: "孕婦攝取大型魚類不應超過 2 份。",
      },
    ]);
    expect(result.verdict).toBe("partial");
    expect(result.reasons.join()).toContain("孕婦");
  });
});

describe("summarize 與發布稿", () => {
  const sentences = [
    "甲基汞可經由食物鏈累積於大型魚類。[K-0001]",
    "長期攝取甲基汞會影響胎兒神經發育。[K-0003]",
    "颱風假由地方政府各自宣布。",
  ];

  it("統計三種判定的數量", () => {
    const summary = summarize(verifyAnswerSentences(sentences, FACTS));
    expect(summary.supported).toBe(1);
    expect(summary.partial).toBe(1);
    expect(summary.unsupported).toBe(1);
  });

  it("有紅色句子就不可發布", () => {
    const summary = summarize(verifyAnswerSentences(sentences, FACTS));
    expect(summary.publishable).toBe(false);
  });

  it("沒有紅色句子才可發布", () => {
    const summary = summarize(verifyAnswerSentences(sentences.slice(0, 2), FACTS));
    expect(summary.publishable).toBe(true);
  });

  it("完全沒有句子時不可發布", () => {
    expect(summarize([]).publishable).toBe(false);
  });

  it("發布稿一定不含紅色句子", () => {
    const results = verifyAnswerSentences(sentences, FACTS);
    const published = buildPublishableAnswer(results);

    expect(published).not.toContain("颱風假");
    expect(published).toContain("甲基汞可經由食物鏈累積於大型魚類。");
    // 黃色句子保留，交由使用者確認
    expect(published).toContain("胎兒神經發育");
  });

  it("全部都是紅色時發布稿為空字串", () => {
    const results = verifyAnswerSentences(["颱風假由地方政府各自宣布。"], FACTS);
    expect(buildPublishableAnswer(results)).toBe("");
  });
});
