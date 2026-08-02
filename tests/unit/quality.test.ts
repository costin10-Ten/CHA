// @vitest-environment node
import { describe, expect, it } from "vitest";

import { EMPTY_CONDITIONS, type RawFact } from "@shared/extraction.ts";
import {
  QUALITY_FLAGS,
  checkFactQuality,
  extractNumbers,
  isContradiction,
  isDuplicateStatement,
  isMultiProposition,
  quoteExistsInParagraph,
} from "@shared/quality.ts";

function fact(overrides: Partial<RawFact> = {}): RawFact {
  return {
    statement: "氫氟酸接觸皮膚可能造成深層灼傷。",
    subject: "氫氟酸",
    predicate: "造成",
    object: "深層灼傷",
    proposition_types: ["substance_property"],
    conditions: { ...EMPTY_CONDITIONS },
    source_quote: "氫氟酸接觸皮膚可能造成深層灼傷。",
    source_paragraph_id: "P-001",
    risk_level: "high",
    confidence: 0.8,
    ...overrides,
  };
}

const PARAGRAPH =
  "氫氟酸接觸皮膚可能造成深層灼傷。建議立即以大量清水沖洗 15 分鐘。";

describe("quoteExistsInParagraph", () => {
  it("原文片段存在時通過", () => {
    expect(
      quoteExistsInParagraph("氫氟酸接觸皮膚可能造成深層灼傷。", PARAGRAPH),
    ).toBe(true);
  });

  it("允許空白與全形半形標點差異", () => {
    expect(
      quoteExistsInParagraph(" 氫氟酸接觸皮膚可能造成深層灼傷 。 ", PARAGRAPH),
    ).toBe(true);
  });

  it("原文沒有的片段不通過", () => {
    expect(quoteExistsInParagraph("氫氟酸可以安全飲用。", PARAGRAPH)).toBe(false);
  });

  it("空白片段不通過", () => {
    expect(quoteExistsInParagraph("   ", PARAGRAPH)).toBe(false);
  });
});

describe("checkFactQuality 致命問題", () => {
  it("缺少原文片段直接判定 fatal", () => {
    const result = checkFactQuality(fact({ source_quote: "" }), {
      paragraphText: PARAGRAPH,
    });
    expect(result.fatal).toBe(true);
    expect(result.flags).toContain(QUALITY_FLAGS.MISSING_QUOTE);
  });

  it("片段不存在於原文直接判定 fatal", () => {
    const result = checkFactQuality(fact({ source_quote: "氫氟酸對人體無害。" }), {
      paragraphText: PARAGRAPH,
    });
    expect(result.fatal).toBe(true);
    expect(result.flags).toContain(QUALITY_FLAGS.QUOTE_NOT_IN_SOURCE);
  });

  it("合格原子命題沒有任何標記且滿分", () => {
    const result = checkFactQuality(fact(), { paragraphText: PARAGRAPH });
    expect(result.fatal).toBe(false);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(100);
  });
});

describe("checkFactQuality 品質標記", () => {
  it("數字與原文不一致時標記", () => {
    const result = checkFactQuality(
      fact({
        statement: "建議立即以大量清水沖洗 30 分鐘。",
        source_quote: "建議立即以大量清水沖洗 15 分鐘。",
      }),
      { paragraphText: PARAGRAPH },
    );
    expect(result.flags).toContain(QUALITY_FLAGS.NUMBER_MISMATCH);
  });

  it("數字與原文一致時不標記", () => {
    const result = checkFactQuality(
      fact({
        statement: "建議立即以大量清水沖洗 15 分鐘。",
        source_quote: "建議立即以大量清水沖洗 15 分鐘。",
      }),
      { paragraphText: PARAGRAPH },
    );
    expect(result.flags).not.toContain(QUALITY_FLAGS.NUMBER_MISMATCH);
  });

  it("以指代詞開頭視為主詞不完整", () => {
    const result = checkFactQuality(
      fact({ statement: "該物質接觸皮膚可能造成深層灼傷。" }),
      { paragraphText: PARAGRAPH },
    );
    expect(result.flags).toContain(QUALITY_FLAGS.INCOMPLETE_SUBJECT);
  });

  it("把可能性改寫成確定語氣時標記", () => {
    const result = checkFactQuality(
      fact({ statement: "氫氟酸接觸皮膚會造成深層灼傷。" }),
      { paragraphText: PARAGRAPH },
    );
    expect(result.flags).toContain(QUALITY_FLAGS.CERTAINTY_ESCALATED);
  });

  it("原文沒有推論連接詞但敘述有時標記", () => {
    const result = checkFactQuality(
      fact({
        statement: "因此氫氟酸接觸皮膚可能造成深層灼傷。",
      }),
      { paragraphText: PARAGRAPH },
    );
    expect(result.flags).toContain(QUALITY_FLAGS.INFERENCE_SUSPECTED);
  });

  it("原文帶條件但敘述與 conditions 都沒保留時標記", () => {
    const paragraph = "孕婦每週攝取大型魚類不應超過兩份。";
    const result = checkFactQuality(
      fact({
        statement: "攝取大型魚類不應超過兩份。",
        source_quote: paragraph,
      }),
      { paragraphText: paragraph },
    );
    expect(result.flags).toContain(QUALITY_FLAGS.CONDITION_LOST);
  });

  it("條件寫進 conditions 欄位就不標記遺失", () => {
    const paragraph = "孕婦每週攝取大型魚類不應超過兩份。";
    const result = checkFactQuality(
      fact({
        statement: "攝取大型魚類不應超過兩份。",
        source_quote: paragraph,
        conditions: { ...EMPTY_CONDITIONS, population: "孕婦", timeframe: "每週" },
      }),
      { paragraphText: paragraph },
    );
    expect(result.flags).not.toContain(QUALITY_FLAGS.CONDITION_LOST);
  });

  it("模型信心過低時標記", () => {
    const result = checkFactQuality(fact({ confidence: 0.2 }), {
      paragraphText: PARAGRAPH,
    });
    expect(result.flags).toContain(QUALITY_FLAGS.LOW_CONFIDENCE);
  });

  it("重複敘述會被標記", () => {
    const result = checkFactQuality(fact(), {
      paragraphText: PARAGRAPH,
      previousStatements: [
        { statement: "氫氟酸接觸皮膚可能造成深層灼傷。", subject: "氫氟酸" },
      ],
    });
    expect(result.flags).toContain(QUALITY_FLAGS.DUPLICATE);
  });

  it("標記越多分數越低", () => {
    const clean = checkFactQuality(fact(), { paragraphText: PARAGRAPH });
    const messy = checkFactQuality(
      fact({ statement: "該物質因此會造成深層灼傷，且需要立即沖洗。" }),
      { paragraphText: PARAGRAPH },
    );
    expect(messy.score).toBeLessThan(clean.score);
    expect(messy.fatal).toBe(false);
  });
});

describe("isMultiProposition", () => {
  it.each([
    "氫氟酸具腐蝕性。接觸後應立即沖洗。",
    "氫氟酸具腐蝕性，且會滲透皮膚。",
    "氫氟酸具腐蝕性；需要特殊處理。",
  ])("%s 視為多命題", (statement) => {
    expect(isMultiProposition(statement)).toBe(true);
  });

  it.each(["氫氟酸具有腐蝕性。", "孕婦每週不應攝取超過兩份大型魚類。"])(
    "%s 視為單一命題",
    (statement) => {
      expect(isMultiProposition(statement)).toBe(false);
    },
  );
});

describe("extractNumbers", () => {
  it("抽出數值與單位", () => {
    expect(extractNumbers("含量為 3.5 mg/L，低於 10 ppm 的限值")).toEqual([
      "3.5mg/L",
      "10ppm",
    ]);
  });

  it("忽略千分位逗號", () => {
    expect(extractNumbers("1,000 人")).toEqual(["1000人"]);
  });
});

describe("isDuplicateStatement", () => {
  it("忽略空白與標點差異", () => {
    expect(isDuplicateStatement("汞會累積於魚類。", " 汞會累積於魚類 。")).toBe(
      true,
    );
  });

  it("不同內容不算重複", () => {
    expect(isDuplicateStatement("汞會累積於魚類。", "汞不會累積於魚類。")).toBe(
      false,
    );
  });
});

describe("isContradiction", () => {
  it("同主體但一肯定一否定視為矛盾", () => {
    expect(
      isContradiction("甲基汞會累積於大型魚類。", "甲基汞不會累積於大型魚類。"),
    ).toBe(true);
  });

  it("同主體同單位但數值不同視為矛盾", () => {
    expect(
      isContradiction("每日建議攝取不超過 2 份。", "每日建議攝取不超過 5 份。"),
    ).toBe(true);
  });

  it("主體不同不算矛盾", () => {
    expect(isContradiction("汞會累積於魚類。", "蘇丹紅禁止用於食品。")).toBe(false);
  });

  it("完全相同的敘述算重複而非矛盾", () => {
    expect(isContradiction("汞會累積於魚類。", "汞會累積於魚類。")).toBe(false);
  });
});

/**
 * 「醫學健康建議」依規定必須來自政府機關來源。
 *
 * 這裡只標記、不擋下：網域判斷是啟發式的，硬擋會誤傷上傳的部會 PDF。
 * 帶標記的命題不符合批次核定條件，等於強制要有人單獨看過。
 */
describe("醫學健康建議的來源限制", () => {
  const advice = fact({
    statement: "皮膚接觸後應立即以大量清水沖洗並儘速就醫。",
    source_quote: "皮膚接觸後應立即以大量清水沖洗並儘速就醫",
    proposition_types: ["health_advice"],
  });
  const context = { paragraphText: advice.source_quote };

  it("政府網域不標記", () => {
    for (const url of [
      "https://www.moenv.gov.tw/article",
      "https://www.fda.gov.tw/TC/news.aspx",
      "https://www.who.int/news-room/fact-sheets",
      "https://food.ec.europa.eu/safety",
    ]) {
      const result = checkFactQuality(advice, { ...context, sourceUrl: url });
      expect(result.flags, url).not.toContain("health_advice_source_not_gov");
    }
  });

  it("非政府網域會標記", () => {
    for (const url of [
      "https://example.com/health",
      "https://blog.example.tw/post",
      "https://notgov.tw/a",
      "",
    ]) {
      const result = checkFactQuality(advice, { ...context, sourceUrl: url });
      expect(result.flags, url).toContain("health_advice_source_not_gov");
    }
  });

  it("人已經確認是政府來源時，覆寫網址判斷", () => {
    // 上傳的部會 PDF 沒有網址可看，只有人知道它是哪裡來的。
    const result = checkFactQuality(advice, {
      ...context,
      sourceUrl: null,
      sourceIsGovernment: true,
    });
    expect(result.flags).not.toContain("health_advice_source_not_gov");
  });

  it("不是醫學健康建議就不檢查來源", () => {
    const result = checkFactQuality(
      { ...advice, proposition_types: ["toxicology_mechanism"] },
      { ...context, sourceUrl: "https://example.com/health" },
    );
    expect(result.flags).not.toContain("health_advice_source_not_gov");
  });

  it("標記只是標記，不是 fatal", () => {
    const result = checkFactQuality(advice, {
      ...context,
      sourceUrl: "https://example.com/health",
    });
    expect(result.fatal).toBe(false);
    // 但分數被扣，且帶標記者不符合批次核定條件。
    expect(result.score).toBeLessThan(100);
  });
});
