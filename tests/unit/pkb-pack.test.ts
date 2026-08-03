import { describe, expect, it } from "vitest";

import {
  PKB_SOURCE_TYPES,
  normalizeSourceType,
  validatePkbPack,
} from "@shared/pkb-pack.ts";

/**
 * 個人原子知識庫的匯入包驗證。
 *
 * 與 CHA 最大的差別：不比對原文。唯一的硬性要求是
 * 「說得出這句話從哪來」——statement 與 source_label。
 */

function pack(overrides: Record<string, unknown> = {}) {
  return {
    source: { title: "化學物質管理法簡介", url: "https://cha.gov.tw/x" },
    items: [
      {
        ref: "K001",
        statement: "化學物質登錄制度由環境部化學物質管理署主管。",
        source_type: "國內法規",
      },
    ],
    ...overrides,
  };
}

describe("最小可用格式", () => {
  it("只要有敘述與來源名稱就能匯入", () => {
    const result = validatePkbPack({
      source: { title: "某篇科普文章" },
      items: [{ statement: "鎘會蓄積於腎臟。" }],
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].source_label).toBe("某篇科普文章");
    expect(result.items[0].ref).toBe("K001");
  });

  it("整包的來源資訊會被每一筆沿用", () => {
    const result = validatePkbPack(pack());
    expect(result.items[0].source_label).toBe("化學物質管理法簡介");
    expect(result.items[0].source_url).toBe("https://cha.gov.tw/x");
  });

  it("逐筆的來源會蓋過整包的", () => {
    const result = validatePkbPack(
      pack({
        items: [
          {
            statement: "另一句知識。",
            source_label: "自己的來源",
            source_url: "https://example.test/y",
          },
        ],
      }),
    );
    expect(result.items[0].source_label).toBe("自己的來源");
    expect(result.items[0].source_url).toBe("https://example.test/y");
  });
});

describe("來源名稱是硬性要求", () => {
  it("整包與逐筆都沒有來源名稱時跳過那一筆", () => {
    const result = validatePkbPack({
      items: [{ statement: "沒有來源的知識。" }],
    });

    expect(result.ok).toBe(false);
    expect(result.summary.skipped).toBe(1);
    expect(
      result.issues.some((issue) => issue.message.includes("沒有來源名稱")),
    ).toBe(true);
  });

  it("一筆缺來源不會拖垮其他筆", () => {
    const result = validatePkbPack({
      items: [
        { statement: "有來源的知識。", source_label: "來源甲" },
        { statement: "沒有來源的知識。" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.summary.skipped).toBe(1);
  });
});

describe("九類來源分類（單選）", () => {
  it("中文全名與簡稱都認得", () => {
    const cases: [string, string][] = [
      ["科普文章", "popular_science"],
      ["國內法規", "domestic_law"],
      ["本署業務", "own_duty"],
      ["本屬業務", "own_duty"],
      ["環境部新聞", "moenv_news"],
      ["國外管理制度", "foreign_regulation"],
      ["國外最新新聞", "foreign_news"],
      ["本部重點推動", "ministry_priority"],
      ["模擬題", "mock_question"],
      ["正式發想點", "formal_idea"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeSourceType(input).value, input).toBe(expected);
    }
  });

  it("認不得的分類退到「其他」並提醒，不擋下匯入", () => {
    const result = validatePkbPack(
      pack({ items: [{ statement: "一句知識。", source_type: "外星分類" }] }),
    );

    expect(result.ok).toBe(true);
    expect(result.items[0].source_type).toBe("other");
    expect(result.issues.some((issue) => issue.message.includes("外星分類"))).toBe(
      true,
    );
  });

  it("沒填分類時退到「其他」並提醒", () => {
    const result = validatePkbPack({
      items: [{ statement: "一句知識。", source_label: "來源甲" }],
    });

    expect(result.items[0].source_type).toBe("other");
    expect(
      result.issues.some((issue) => issue.message.includes("沒有來源分類")),
    ).toBe(true);
  });

  it("每個列舉值都有中文對應", () => {
    for (const value of PKB_SOURCE_TYPES) {
      expect(normalizeSourceType(value).value, value).toBe(value);
    }
  });
});

describe("自製內容會被標記", () => {
  it("模擬題與正式發想點標成自製", () => {
    for (const type of ["模擬題", "正式發想點"]) {
      const result = validatePkbPack(
        pack({ items: [{ statement: "一句知識。", source_type: type }] }),
      );
      expect(result.items[0].is_self_authored, type).toBe(true);
    }
  });

  it("外部來源不是自製", () => {
    const result = validatePkbPack(pack());
    expect(result.items[0].is_self_authored).toBe(false);
    expect(result.summary.selfAuthored).toBe(0);
  });
});

describe("沿用 CHA 的文章包", () => {
  it("CHA 的 source_type（text／file／url）不會被當成來源分類", () => {
    // 那是「原文怎麼來的」，與九類來源分類是兩件事。
    // 誤當成分類會讓每一筆都掉進「其他」還跳出警告。
    for (const value of ["url", "file", "text"]) {
      const result = normalizeSourceType(value);
      expect(result.value, value).toBeNull();
      expect(result.unrecognized, value).toBeNull();
    }
  });

  it("CHA 的 facts + proposition_types 直接可用，分類併進標籤", () => {
    const result = validatePkbPack({
      source: {
        title: "食品中的重金屬殘留標準",
        url: "https://example.gov.tw/a",
        source_type: "url",
      },
      facts: [
        {
          ref: "C001",
          statement: "稻米的鎘限量標準為每公斤 0.4 毫克。",
          subject: "稻米",
          predicate: "鎘限量",
          object: "每公斤 0.4 毫克",
          proposition_types: ["domestic_policy", "substance_property"],
          status: "核定",
        },
      ],
    });

    expect(result.ok).toBe(true);
    const item = result.items[0];
    expect(item.source_label).toBe("食品中的重金屬殘留標準");
    expect(item.subject).toBe("稻米");
    expect(item.tags).toEqual(["domestic_policy", "substance_property"]);
    expect(item.approved_in_pack).toBe(true);
    // CHA 的 url 沒有被誤判成分類，只是沒有九類資訊而已。
    expect(item.source_type).toBe("other");
  });
});

describe("駁回的不匯入", () => {
  it("標示駁回的略過並回報", () => {
    const result = validatePkbPack(
      pack({
        items: [
          { ref: "K001", statement: "留下的知識。", source_type: "科普文章" },
          { ref: "K002", statement: "不成立的知識。", status: "駁回" },
        ],
      }),
    );

    expect(result.items.map((item) => item.ref)).toEqual(["K001"]);
    expect(result.summary.rejected).toBe(1);
    expect(result.issues.some((issue) => issue.message.includes("略過 1 筆"))).toBe(
      true,
    );
  });

  it("整包都是駁回時沒有可匯入的內容", () => {
    const result = validatePkbPack(
      pack({ items: [{ statement: "不成立的知識。", status: "駁回" }] }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("都標示駁回")),
    ).toBe(true);
  });
});

describe("其他寬鬆處理", () => {
  it("底線開頭的說明欄位不會變成資料", () => {
    const result = validatePkbPack(
      pack({
        items: [
          {
            _註: "這是給人看的",
            statement: "一句知識。",
            source_type: "科普文章",
          },
        ],
      }),
    );
    expect(result.items[0].statement).toBe("一句知識。");
  });

  it("編號重複時保留第一筆", () => {
    const result = validatePkbPack(
      pack({
        items: [
          { ref: "K001", statement: "第一筆。", source_type: "科普文章" },
          { ref: "K001", statement: "第二筆。", source_type: "科普文章" },
        ],
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].statement).toBe("第一筆。");
  });

  it("統計各來源分類的筆數供匯入前確認", () => {
    const result = validatePkbPack(
      pack({
        items: [
          { statement: "甲。", source_type: "科普文章" },
          { statement: "乙。", source_type: "科普文章" },
          { statement: "丙。", source_type: "模擬題" },
        ],
      }),
    );
    expect(result.summary.bySourceType).toEqual({
      popular_science: 2,
      mock_question: 1,
    });
    expect(result.summary.selfAuthored).toBe(1);
  });

  it("不是 JSON 物件時明確回報", () => {
    expect(validatePkbPack("字串").ok).toBe(false);
    expect(validatePkbPack(null).issues[0].message).toContain("不是 JSON 物件");
  });

  it("找不到清單時給提示", () => {
    const result = validatePkbPack({ source: { title: "只有來源" } });
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain("找不到任何原子知識");
  });
});
