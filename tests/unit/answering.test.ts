// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerMessages,
  buildEvidencePack,
  declaresInsufficient,
  extractCitations,
  findUnknownCitations,
  formatKnowledgeRef,
  splitAnswerSentences,
  type EvidenceFact,
} from "@shared/answering.ts";
import { MockProvider, buildMockAnswer, isAnswerPrompt } from "@shared/llm/mock.ts";

function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    knowledgeId: "K-0001",
    factId: "11111111-1111-1111-1111-111111111111",
    statement: "甲基汞可經由食物鏈累積於大型魚類。",
    conditions: { population: "孕婦", timeframe: null },
    sourceTitle: "汞的健康風險",
    sourceUrl: "https://example.com/mercury",
    sourceLocator: "第 P-002 段",
    version: 1,
    ...overrides,
  };
}

describe("formatKnowledgeRef", () => {
  it("從 K-0001 開始編號", () => {
    expect(formatKnowledgeRef(0)).toBe("K-0001");
    expect(formatKnowledgeRef(11)).toBe("K-0012");
  });
});

describe("buildEvidencePack", () => {
  it("包含問題與每筆原子命題的來源定位與版本", () => {
    const pack = buildEvidencePack("孕婦吃魚要注意什麼？", [fact()]);

    expect(pack.question).toBe("孕婦吃魚要注意什麼？");
    expect(pack.facts[0]).toMatchObject({
      knowledge_id: "K-0001",
      source_title: "汞的健康風險",
      source_url: "https://example.com/mercury",
      source_locator: "第 P-002 段",
      version: 1,
    });
  });

  it("條件欄位只保留有值的項目", () => {
    const pack = buildEvidencePack("問題", [fact()]);
    expect(pack.facts[0].conditions).toEqual({ population: "孕婦" });
  });

  it("沒有原子命題時 facts 為空陣列", () => {
    expect(buildEvidencePack("問題", []).facts).toEqual([]);
  });
});

describe("ANSWER_SYSTEM_PROMPT", () => {
  it("明確禁止使用模型自身知識並要求標註來源", () => {
    expect(ANSWER_SYSTEM_PROMPT).toContain("不得使用你自己的記憶");
    expect(ANSWER_SYSTEM_PROMPT).toContain("[K-0001]");
    expect(ANSWER_SYSTEM_PROMPT).toContain("不足以回答");
    expect(ANSWER_SYSTEM_PROMPT).toContain("不得把「可能」改寫成");
  });
});

describe("buildAnswerMessages", () => {
  it("證據包完整放進使用者訊息", () => {
    const pack = buildEvidencePack("孕婦吃魚要注意什麼？", [fact()]);
    const messages = buildAnswerMessages(pack);

    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("孕婦吃魚要注意什麼？");
    expect(messages[1].content).toContain("K-0001");
    expect(messages[1].content).toContain("甲基汞可經由食物鏈累積於大型魚類。");
  });
});

describe("extractCitations", () => {
  it("取出引用的知識編號並去重", () => {
    expect(
      extractCitations("甲基汞會累積 [K-0001]。孕婦應注意 [K-0002] [K-0001]。"),
    ).toEqual(["K-0001", "K-0002"]);
  });

  it("沒有引用時回傳空陣列", () => {
    expect(extractCitations("沒有任何引用。")).toEqual([]);
  });
});

describe("findUnknownCitations", () => {
  it("引用證據包以外的編號會被抓出來", () => {
    const pack = buildEvidencePack("問題", [fact()]);
    expect(findUnknownCitations("內容 [K-0001] 與 [K-0009]。", pack)).toEqual([
      "K-0009",
    ]);
  });

  it("全部都在證據包內時回傳空陣列", () => {
    const pack = buildEvidencePack("問題", [fact()]);
    expect(findUnknownCitations("內容 [K-0001]。", pack)).toEqual([]);
  });
});

describe("declaresInsufficient", () => {
  it.each([
    "現有核定原子命題不足以回答這個問題。",
    "知識庫中沒有足夠的核定原子命題。",
  ])("辨識資料不足的說法：%s", (answer) => {
    expect(declaresInsufficient(answer)).toBe(true);
  });

  it("正常回答不會被誤判", () => {
    expect(declaresInsufficient("甲基汞會累積於大型魚類 [K-0001]。")).toBe(false);
  });
});

describe("splitAnswerSentences", () => {
  it("以句末標點與換行拆句", () => {
    const sentences = splitAnswerSentences(
      "甲基汞會累積於大型魚類 [K-0001]。孕婦每週不應超過兩份 [K-0002]。",
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("孕婦");
  });

  it("忽略只有標記或空白的行", () => {
    expect(splitAnswerSentences("\n\n  \n甲基汞會累積於大型魚類。")).toEqual([
      "甲基汞會累積於大型魚類。",
    ]);
  });
});

describe("Mock Provider 的問答模式", () => {
  it("辨識問答提示詞", () => {
    const pack = buildEvidencePack("問題", [fact()]);
    const messages = buildAnswerMessages(pack);
    expect(isAnswerPrompt(messages[1].content)).toBe(true);
  });

  it("只引用證據包中的原子命題，不捏造內容", async () => {
    const pack = buildEvidencePack("孕婦吃魚要注意什麼？", [
      fact(),
      fact({ knowledgeId: "K-0002", statement: "孕婦每週不應攝取超過兩份。" }),
    ]);

    const response = await new MockProvider().complete({
      messages: buildAnswerMessages(pack),
    });

    expect(findUnknownCitations(response.text, pack)).toEqual([]);
    expect(extractCitations(response.text)).toEqual(["K-0001", "K-0002"]);
    expect(response.text).toContain("甲基汞可經由食物鏈累積於大型魚類。");
  });

  it("證據包為空時明確回覆資料不足", () => {
    const pack = buildEvidencePack("問題", []);
    const answer = buildMockAnswer(buildAnswerMessages(pack)[1].content);
    expect(declaresInsufficient(answer)).toBe(true);
  });
});
