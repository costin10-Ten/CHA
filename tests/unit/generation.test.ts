import { describe, expect, it } from "vitest";

import { buildEvidencePack, type EvidenceFact } from "@shared/answering.ts";
import {
  DRAFT_SPECS,
  GENERATION_SYSTEM_PROMPT,
  buildDraftTitle,
  buildGenerationMessages,
  contentOfLine,
  isDraftType,
  structurePrefix,
  summarizeDraft,
  verifyDraftBody,
  type DraftType,
} from "@shared/generation.ts";
import { MockProvider, isGenerationPrompt } from "@shared/llm/mock.ts";

/** 工作單第 15 節列出的十種素材。 */
const REQUIRED_TYPES: DraftType[] = [
  "faq",
  "explainer",
  "article",
  "podcast_outline",
  "podcast_script",
  "video_60s",
  "video_3min",
  "card_text",
  "media_qa",
  "social_post",
];

const FACTS: EvidenceFact[] = [
  {
    knowledgeId: "K-0001",
    factId: "fact-1",
    statement: "孕婦每週攝取旗魚不宜超過 35 公克。",
    conditions: { population: "孕婦", dose: "35 公克" },
    sourceTitle: "示範文件",
    sourceUrl: null,
    sourceLocator: "第 P-001 段",
    version: 1,
  },
  {
    knowledgeId: "K-0002",
    factId: "fact-2",
    statement: "甲基汞可能影響胎兒神經發育。",
    conditions: { population: "胎兒" },
    sourceTitle: "示範文件",
    sourceUrl: null,
    sourceLocator: "第 P-002 段",
    version: 1,
  },
];

function verificationFacts() {
  return FACTS.map((fact) => ({
    knowledgeId: fact.knowledgeId,
    factId: fact.factId,
    statement: fact.statement,
    conditions: fact.conditions,
  }));
}

describe("素材產製提示詞", () => {
  it("涵蓋工作單要求的全部十種素材", () => {
    for (const type of REQUIRED_TYPES) {
      expect(DRAFT_SPECS[type], `缺少素材類型 ${type}`).toBeDefined();
      expect(DRAFT_SPECS[type].label.length).toBeGreaterThan(0);
      expect(DRAFT_SPECS[type].instruction.length).toBeGreaterThan(0);
    }
    expect(Object.keys(DRAFT_SPECS)).toHaveLength(REQUIRED_TYPES.length);
  });

  it("提示詞明確禁止補充自身知識並要求標註知識編號", () => {
    expect(GENERATION_SYSTEM_PROMPT).toContain("只使用清單中的原子命題");
    expect(GENERATION_SYSTEM_PROMPT).toContain("[K-0001]");
    expect(GENERATION_SYSTEM_PROMPT).toContain("不得改動數字");
    expect(GENERATION_SYSTEM_PROMPT).toContain("不聳動");
  });

  it("訊息中只帶入證據包內的原子命題", () => {
    const pack = buildEvidencePack("孕婦吃魚", FACTS);
    const messages = buildGenerationMessages(pack, {
      draftType: "faq",
      audience: "孕婦與育齡女性",
      tone: "平實",
    });

    const user = messages[1].content;
    expect(messages[0].role).toBe("system");
    expect(user).toContain("體裁：FAQ");
    expect(user).toContain("K-0001");
    expect(user).toContain("孕婦每週攝取旗魚不宜超過 35 公克。");
    expect(user).not.toContain("鮪魚");
    expect(isGenerationPrompt(user)).toBe(true);
  });

  it("標題為體裁加主題，過長會截斷", () => {
    expect(buildDraftTitle("faq", "甲基汞")).toBe("FAQ：甲基汞");
    expect(buildDraftTitle("article", "汞".repeat(60))).toMatch(/…$/);
  });

  it("只接受清單內的素材類型", () => {
    expect(isDraftType("faq")).toBe(true);
    expect(isDraftType("tiktok_dance")).toBe(false);
    expect(isDraftType("toString")).toBe(false);
  });
});

describe("Mock Provider 產製素材", () => {
  it("只引用證據包裡的原子命題，且產出可通過逐句驗證", async () => {
    const pack = buildEvidencePack("孕婦吃魚", FACTS);
    const provider = new MockProvider();
    const response = await provider.complete({
      messages: buildGenerationMessages(pack, {
        draftType: "faq",
        audience: "孕婦與育齡女性",
        tone: "平實",
      }),
    });

    expect(response.text).toContain("[K-0001]");
    expect(response.text).toContain("[K-0002]");

    const summary = summarizeDraft(
      verifyDraftBody(response.text, verificationFacts()),
    );
    expect(summary.unsupported).toBe(0);
    expect(summary.publishable).toBe(true);
  });

  it("沒有核定原子命題時說明資料不足，不會自行編寫內容", async () => {
    const pack = buildEvidencePack("完全沒有資料的主題", []);
    const provider = new MockProvider();
    const response = await provider.complete({
      messages: buildGenerationMessages(pack, {
        draftType: "social_post",
        audience: "一般民眾",
        tone: "平實",
      }),
    });

    expect(response.text).toContain("核定原子命題不足");
    expect(response.text).not.toMatch(/\[K-\d{4}\]/);
  });
});

describe("素材的體裁結構與紅色句子", () => {
  it("剝掉題號、秒數與旁白等結構標記", () => {
    expect(structurePrefix("1. 孕婦每週…")).toBe("1. ");
    expect(structurePrefix("Q1：可以吃嗎？")).toBe("Q1：");
    expect(structurePrefix("（0-5 秒）畫面：海鮮攤")).toContain("秒");
    expect(structurePrefix("孕婦每週攝取旗魚")).toBe("");
    expect(contentOfLine("**常見問題**")).toBe("常見問題");
  });

  it("小標與題號不計入綠黃紅統計", () => {
    const body = [
      "FAQ：孕婦吃魚",
      "",
      "1. 孕婦每週攝取旗魚不宜超過 35 公克。 [K-0001]",
      "2. 甲基汞可能影響胎兒神經發育。 [K-0002]",
    ].join("\n");

    const results = verifyDraftBody(body, verificationFacts());
    const structural = results.filter((item) => item.structural);

    expect(structural).toHaveLength(1);
    expect(structural[0].sentence).toBe("FAQ：孕婦吃魚");

    const summary = summarizeDraft(results);
    expect(summary.supported + summary.partial).toBe(2);
    expect(summary.unsupported).toBe(0);
    expect(summary.publishable).toBe(true);
  });

  it("加入沒有原子命題支持的句子後就不可發布", () => {
    const body = [
      "1. 孕婦每週攝取旗魚不宜超過 35 公克。 [K-0001]",
      "2. 喝咖啡可以完全清除體內的汞。",
    ].join("\n");

    const summary = summarizeDraft(verifyDraftBody(body, verificationFacts()));

    expect(summary.unsupported).toBeGreaterThan(0);
    expect(summary.publishable).toBe(false);
  });

  it("圖卡這類很短的內容句仍會被驗證，不會因為短就略過", () => {
    const results = verifyDraftBody(
      ["# 圖卡", "喝咖啡可清除汞"].join("\n"),
      verificationFacts(),
    );

    const claim = results.find((item) => !item.structural);
    expect(claim?.sentence).toBe("喝咖啡可清除汞");
    expect(claim?.verdict).toBe("unsupported");
  });

  it("整份都是結構、沒有任何原子命題主張時不可發布", () => {
    const summary = summarizeDraft(
      verifyDraftBody("# 標題\n\n## 小標", verificationFacts()),
    );

    expect(summary.supported).toBe(0);
    expect(summary.publishable).toBe(false);
  });
});
