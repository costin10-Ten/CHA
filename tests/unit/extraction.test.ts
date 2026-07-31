// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionMessages,
  extractJsonBlock,
  hasAnyCondition,
  normalizeConditions,
  parseFactsResponse,
  promptChecksum,
} from "@shared/extraction.ts";
import { createProvider } from "@shared/llm/factory.ts";
import { MockProvider, splitSentences } from "@shared/llm/mock.ts";
import { estimateTokens } from "@shared/llm/types.ts";
import { checkFactQuality } from "@shared/quality.ts";

describe("buildExtractionMessages", () => {
  it("段落以編號開頭，讓模型能引用來源", () => {
    const messages = buildExtractionMessages("汞的健康風險", [
      { paragraphId: "P-001", text: "甲基汞可累積於大型魚類。" },
      { paragraphId: "P-002", text: "孕婦應限制攝取量。", headingPath: ["建議"] },
    ]);

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(messages[1].content).toContain("[P-001] 甲基汞可累積於大型魚類。");
    expect(messages[1].content).toContain("[P-002]（章節：建議）");
    expect(messages[1].content).toContain("汞的健康風險");
  });
});

describe("EXTRACTION_SYSTEM_PROMPT", () => {
  it("包含工作單要求的核心規則", () => {
    for (const rule of [
      "一句一事",
      "不得超出原文",
      "一字不改",
      "保留同樣的不確定性",
    ]) {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(rule);
    }
  });

  it("checksum 隨內容變動", async () => {
    const a = await promptChecksum(EXTRACTION_SYSTEM_PROMPT);
    const b = await promptChecksum(`${EXTRACTION_SYSTEM_PROMPT} `);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("EXTRACTION_JSON_SCHEMA", () => {
  it("要求每筆事實都有原文片段與段落編號", () => {
    const item = (
      EXTRACTION_JSON_SCHEMA.schema.properties as Record<string, { items: unknown }>
    ).facts.items as { required: string[] };

    expect(item.required).toContain("source_quote");
    expect(item.required).toContain("source_paragraph_id");
    expect(item.required).toContain("statement");
  });
});

describe("extractJsonBlock", () => {
  it("移除程式碼區塊記號", () => {
    expect(extractJsonBlock('```json\n{"facts":[]}\n```')).toBe('{"facts":[]}');
  });

  it("移除前後說明文字", () => {
    expect(extractJsonBlock('好的，結果如下：{"facts":[]} 以上。')).toBe(
      '{"facts":[]}',
    );
  });
});

describe("parseFactsResponse", () => {
  it("丟棄缺少原文片段的項目", () => {
    const result = parseFactsResponse(
      JSON.stringify({
        facts: [
          {
            statement: "有片段。",
            source_quote: "有片段。",
            source_paragraph_id: "P-001",
          },
          { statement: "沒有片段。", source_paragraph_id: "P-001" },
        ],
      }),
    );

    expect(result.facts).toHaveLength(1);
    expect(result.discarded[0].reason).toBe("缺少 source_quote");
  });

  it("丟棄段落編號格式錯誤的項目", () => {
    const result = parseFactsResponse(
      JSON.stringify({
        facts: [
          { statement: "內容。", source_quote: "內容。", source_paragraph_id: "3" },
        ],
      }),
    );

    expect(result.facts).toHaveLength(0);
    expect(result.discarded[0].reason).toBe("source_paragraph_id 格式不正確");
  });

  it("不合法 JSON 不會丟例外", () => {
    const result = parseFactsResponse("這不是 JSON");
    expect(result.facts).toEqual([]);
    expect(result.discarded[0].reason).toBe("回應不是合法 JSON");
  });

  it("補齊預設值並限制 confidence 範圍", () => {
    const result = parseFactsResponse(
      JSON.stringify({
        facts: [
          {
            statement: "內容。",
            source_quote: "內容。",
            source_paragraph_id: "P-002",
            knowledge_type: "不存在的類型",
            risk_level: "extreme",
            confidence: 5,
          },
        ],
      }),
    );

    expect(result.facts[0].knowledge_type).toBe("other");
    expect(result.facts[0].risk_level).toBe("low");
    expect(result.facts[0].confidence).toBe(1);
    expect(result.facts[0].conditions.population).toBeNull();
  });
});

describe("normalizeConditions", () => {
  it("空字串視為未填", () => {
    expect(normalizeConditions({ population: "  ", dose: "5 mg" })).toEqual({
      population: null,
      exposure_route: null,
      dose: "5 mg",
      duration: null,
      location: null,
      timeframe: null,
    });
  });

  it("hasAnyCondition 判斷是否保留條件", () => {
    expect(hasAnyCondition(normalizeConditions({}))).toBe(false);
    expect(hasAnyCondition(normalizeConditions({ population: "孕婦" }))).toBe(true);
  });
});

describe("MockProvider", () => {
  it("預設 provider 是 mock，測試不會呼叫付費 API", () => {
    expect(createProvider({}).name).toBe("mock");
    expect(createProvider({ provider: "mock" })).toBeInstanceOf(MockProvider);
  });

  it("未知 provider 會明確報錯", () => {
    expect(() => createProvider({ provider: "gemini" })).toThrowError(
      /未知的 LLM_PROVIDER/,
    );
  });

  it("以段落產生候選事實，每句一筆且附原文片段", async () => {
    const provider = new MockProvider();
    const messages = buildExtractionMessages("氫氟酸", [
      {
        paragraphId: "P-001",
        text: "氫氟酸是氟化氫的水溶液。接觸皮膚可能造成深層灼傷。",
      },
    ]);

    const response = await provider.complete({ messages });
    const parsed = parseFactsResponse(response.text);

    expect(parsed.facts).toHaveLength(2);
    expect(parsed.facts[0].source_paragraph_id).toBe("P-001");
    expect(parsed.facts[0].source_quote).toBe("氫氟酸是氟化氫的水溶液。");
    expect(response.provider).toBe("mock");
    expect(response.inputTokens).toBeGreaterThan(0);
  });

  it("產出的事實能通過品質檢查（片段確實在原文中）", async () => {
    const paragraph =
      "甲基汞可經由食物鏈累積於大型魚類。孕婦每週不應攝取超過兩份。";
    const provider = new MockProvider();
    const response = await provider.complete({
      messages: buildExtractionMessages("汞", [
        { paragraphId: "P-001", text: paragraph },
      ]),
    });

    for (const fact of parseFactsResponse(response.text).facts) {
      const quality = checkFactQuality(fact, { paragraphText: paragraph });
      expect(quality.fatal).toBe(false);
    }
  });
});

describe("splitSentences", () => {
  it("以句末標點切句並忽略過短片段", () => {
    expect(splitSentences("氫氟酸具有腐蝕性。短。接觸後應立即沖洗患部。")).toEqual([
      "氫氟酸具有腐蝕性。",
      "接觸後應立即沖洗患部。",
    ]);
  });
});

describe("estimateTokens", () => {
  it("中文與英文都給出正數估算", () => {
    expect(estimateTokens("氫氟酸")).toBeGreaterThan(0);
    expect(estimateTokens("hydrofluoric acid")).toBeGreaterThan(0);
  });
});
