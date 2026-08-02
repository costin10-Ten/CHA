import { describe, expect, it } from "vitest";

import {
  candidateRef,
  chunkRef,
  isBindingPlaceholder,
  isContentPlaceholder,
  quoteMatches,
  validateArticlePack,
} from "@shared/article-pack.ts";

/**
 * 文章包驗證：寬進嚴審。
 *
 * 「寬」= 欄位別名、列舉值、段落編號、缺漏欄位都自動處理，
 *        一筆有問題只跳過那一筆，不會整包擋下。
 * 「嚴」= 引句對不上原文的原子命題一律退回待審核，不會被當成已核定。
 */

const PARAGRAPH =
  "賽滅寧屬於合成除蟲菊酯類，作用於昆蟲神經系統的鈉離子通道，使神經持續興奮，最終導致麻痺死亡。";

function pack(overrides: Record<string, unknown> = {}) {
  return {
    export_meta: { format: "CHA-database-aligned-export", format_version: 2 },
    sources: [
      {
        title: "測試文章",
        source_type: "url",
        origin_url: "https://example.test/a",
      },
    ],
    source_versions: [{ version: 1, parser_version: "test/1.0" }],
    document_chunks: [
      {
        paragraph_id: "P-004",
        position: 4,
        block_type: "paragraph",
        heading_path: ["小節"],
        text: PARAGRAPH,
      },
    ],
    candidate_facts: [
      {
        ref: "C001",
        statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
        proposition_types: ["substance_property"],
        risk_level: "medium",
        conditions: { population: null },
        source_paragraph_id: "P-004",
        source_quote: "作用於昆蟲神經系統的鈉離子通道",
        status: "approved",
      },
    ],
    review_records: [
      {
        candidate_fact_id: "$candidate_facts[C001].id",
        action: "approve",
        from_status: "pending",
        to_status: "approved",
      },
    ],
    knowledge_facts: [
      {
        ref: "F001",
        candidate_fact_id: "$candidate_facts[C001].id",
        statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
        tags: ["賽滅寧"],
      },
    ],
    processing_jobs: [],
    ...overrides,
  };
}

const first = (input: unknown) => validateArticlePack(input).articles[0];

describe("佔位符分類", () => {
  it("綁定佔位符是合法的，由匯入流程解析", () => {
    for (const value of [
      "$auth.uid()",
      "$import_time",
      "$sources[0].id",
      "$document_chunks[P-004].id",
      "$candidate_facts[C001].id",
    ]) {
      expect(isBindingPlaceholder(value), value).toBe(true);
      expect(isContentPlaceholder(value), value).toBe(false);
    }
  });

  it("內容佔位符代表原文沒有附上", () => {
    for (const value of [
      "$resolve_source_paragraph(P-004)",
      "$resolve_quote(P-004,C001)",
      "${paragraph}",
      "<原文>",
      "TODO",
      "待填",
    ]) {
      expect(isContentPlaceholder(value), value).toBe(true);
    }
  });

  it("參照可以是綁定寫法或直接寫 ref", () => {
    expect(candidateRef("$candidate_facts[C001].id")).toBe("C001");
    expect(candidateRef("C001")).toBe("C001");
    expect(chunkRef("$document_chunks[P-004].id")).toBe("P-004");
  });
});

describe("合法的文章包", () => {
  const result = validateArticlePack(pack());

  it("通過驗證並整理出可匯入的資料", () => {
    expect(result.ok).toBe(true);
    expect(result.articles).toHaveLength(1);
    expect(first(pack()).chunks).toHaveLength(1);
    expect(first(pack()).candidates[0].ref).toBe("C001");
    expect(first(pack()).knowledgeFacts[0].candidate_fact_id).toBe("C001");
  });

  it("統計數量供匯入前確認", () => {
    expect(result.summary).toMatchObject({
      articles: 1,
      chunks: 1,
      candidates: 1,
      approved: 1,
      knowledgeFacts: 1,
      reviews: 1,
      quoteFallbacks: 0,
    });
  });
});

describe("寬鬆處理：欄位別名", () => {
  it("接受精簡寫法：source + facts + 原子命題自帶原文", () => {
    const result = validateArticlePack({
      source: { title: "精簡寫法", url: "https://example.test/b" },
      facts: [
        {
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_id: "P-004",
          paragraph_text: PARAGRAPH,
          quote: "作用於昆蟲神經系統的鈉離子通道",
          status: "核定",
        },
      ],
    });

    expect(result.ok).toBe(true);
    const article = result.articles[0];
    expect(article.source.title).toBe("精簡寫法");
    expect(article.source.origin_url).toBe("https://example.test/b");
    expect(article.chunks).toHaveLength(1);
    expect(article.candidates[0].status).toBe("approved");
    expect(article.candidates[0].quote_fallback).toBe(false);
  });

  it("中文欄位名與中文列舉值都接受", () => {
    const result = validateArticlePack({
      source: { title: "中文欄位" },
      原子命題: [
        {
          敘述: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          段落: "P-004",
          段落原文: PARAGRAPH,
          原文片段: "作用於昆蟲神經系統的鈉離子通道",
          審核狀態: "核定",
          風險等級: "高",
          分類: "物質、毒理",
        },
      ],
    });

    const candidate = result.articles[0].candidates[0];
    expect(candidate.status).toBe("approved");
    expect(candidate.risk_level).toBe("high");
    expect(candidate.proposition_types).toEqual([
      "substance_property",
      "toxicology_mechanism",
    ]);
  });

  it("沒有 ref 時自動編號，段落編號寫法不一也能對上", () => {
    const result = validateArticlePack({
      source: { title: "自動編號" },
      document_chunks: [{ paragraph_id: "4", text: PARAGRAPH }],
      facts: [
        {
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_id: "P004",
          quote: "作用於昆蟲神經系統的鈉離子通道",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.articles[0].candidates[0].ref).toBe("C001");
    expect(result.articles[0].candidates[0].source_paragraph_id).toBe("P-004");
  });

  it("列舉值無法辨識時回落預設值並提醒，不擋下匯入", () => {
    const result = validateArticlePack(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
            source_paragraph_id: "P-004",
            source_quote: "作用於昆蟲神經系統的鈉離子通道",
            proposition_types: ["外星分類"],
            risk_level: "爆表",
            status: "不知道",
          },
        ],
        knowledge_facts: [],
      }),
    );

    expect(result.ok).toBe(true);
    const candidate = result.articles[0].candidates[0];
    // 分類認不得就是未分類，不回落成某一類。
    expect(candidate.proposition_types).toEqual([]);
    expect(candidate.risk_level).toBe("medium");
    expect(candidate.status).toBe("pending");
    expect(result.issues.every((issue) => issue.level === "warning")).toBe(true);
  });
});

describe("寬鬆處理：引句", () => {
  it("引句可用刪節號串接多段", () => {
    expect(
      quoteMatches("賽滅寧屬於合成除蟲菊酯類…最終導致麻痺死亡", PARAGRAPH),
    ).toBe(true);
    expect(quoteMatches("賽滅寧會在人體累積", PARAGRAPH)).toBe(false);
  });

  it("引句對不上時退回整段，並強制回到待審核", () => {
    const result = validateArticlePack(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統。",
            source_paragraph_id: "P-004",
            source_quote: "這句話原文裡沒有",
            status: "approved",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    const candidate = result.articles[0].candidates[0];

    expect(candidate.quote_fallback).toBe(true);
    expect(candidate.source_quote).toBe(PARAGRAPH);
    expect(candidate.status).toBe("pending");
    expect(candidate.quality_flags).toContain("quote_not_verified");
    expect(result.summary.quoteFallbacks).toBe(1);
  });

  it("引句是佔位符或缺漏時同樣退回整段，不再整包擋下", () => {
    for (const quote of ["$resolve_quote(P-004,C001)", "", undefined]) {
      const result = validateArticlePack(
        pack({
          candidate_facts: [
            {
              ref: "C001",
              statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
              source_paragraph_id: "P-004",
              source_quote: quote,
              status: "approved",
            },
          ],
          knowledge_facts: [],
        }),
      );

      expect(result.ok, String(quote)).toBe(true);
      expect(result.articles[0].candidates[0].quote_fallback).toBe(true);
      expect(result.articles[0].candidates[0].status).toBe("pending");
    }
  });

  it("退回整段的原子命題不會產生正式原子命題", () => {
    const result = validateArticlePack(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統。",
            source_paragraph_id: "P-004",
            source_quote: "$resolve_quote(P-004,C001)",
            status: "approved",
          },
        ],
      }),
    );

    expect(result.articles[0].knowledgeFacts).toHaveLength(0);
    expect(result.issues.some((issue) => issue.hint?.includes("核定後"))).toBe(
      true,
    );
  });
});

describe("寬鬆處理：部分匯入", () => {
  it("一筆原子命題沒有原文時只跳過該筆，其餘照常匯入", () => {
    const result = validateArticlePack(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
            source_paragraph_id: "P-004",
            source_quote: "作用於昆蟲神經系統的鈉離子通道",
            status: "approved",
          },
          {
            ref: "C002",
            statement: "這一筆引用了不存在的段落。",
            source_paragraph_id: "P-999",
            source_quote: "任何內容",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.articles[0].candidates).toHaveLength(1);
    expect(result.articles[0].candidates[0].ref).toBe("C001");
    expect(
      result.issues.some((issue) => issue.message.includes("這一筆跳過")),
    ).toBe(true);
  });

  it("段落文字是佔位符時，原子命題可用自帶原文救回來", () => {
    const result = validateArticlePack(
      pack({
        document_chunks: [
          { paragraph_id: "P-004", text: "$resolve_source_paragraph(P-004)" },
        ],
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
            source_paragraph_id: "P-004",
            paragraph_text: PARAGRAPH,
            source_quote: "作用於昆蟲神經系統的鈉離子通道",
            status: "approved",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.articles[0].chunks[0].text).toBe(PARAGRAPH);
    expect(result.articles[0].candidates[0].quote_fallback).toBe(false);
  });

  it("完全沒有原文時該筆跳過，整篇沒有原子命題才判定不可匯入", () => {
    const result = validateArticlePack(
      pack({
        document_chunks: [
          { paragraph_id: "P-004", text: "$resolve_source_paragraph(P-004)" },
        ],
        candidate_facts: [
          {
            ref: "C001",
            statement: "沒有任何原文可以對照的原子命題。",
            source_paragraph_id: "P-004",
            source_quote: "$resolve_quote(P-004,C001)",
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.articles).toHaveLength(0);
    expect(
      result.issues.some((issue) => issue.hint?.includes("paragraph_text")),
    ).toBe(true);
  });
});

describe("多篇文章", () => {
  it("一個檔案可以放多篇", () => {
    const result = validateArticlePack({
      articles: [
        {
          source: { title: "第一篇" },
          facts: [
            {
              statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
              paragraph_id: "P-001",
              paragraph_text: PARAGRAPH,
              quote: "作用於昆蟲神經系統的鈉離子通道",
            },
          ],
        },
        {
          source: { title: "第二篇" },
          facts: [
            {
              statement: "賽滅寧屬於合成除蟲菊酯類。",
              paragraph_id: "P-001",
              paragraph_text: PARAGRAPH,
              quote: "賽滅寧屬於合成除蟲菊酯類",
            },
          ],
        },
      ],
    });

    expect(result.summary.articles).toBe(2);
    expect(result.articles.map((article) => article.source.title)).toEqual([
      "第一篇",
      "第二篇",
    ]);
  });

  it("其中一篇有問題時只跳過那一篇", () => {
    const result = validateArticlePack({
      articles: [
        { source: {}, facts: [] },
        {
          source: { title: "好的那篇" },
          facts: [
            {
              statement: "賽滅寧屬於合成除蟲菊酯類。",
              paragraph_id: "P-001",
              paragraph_text: PARAGRAPH,
              quote: "賽滅寧屬於合成除蟲菊酯類",
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.summary.articles).toBe(1);
    expect(result.articles[0].source.title).toBe("好的那篇");
  });
});

describe("正式原子命題", () => {
  it("對應不到原子命題時只略過，不擋下整包", () => {
    const result = validateArticlePack(
      pack({
        knowledge_facts: [
          { ref: "F001", candidate_fact_id: "$candidate_facts[C999].id" },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.articles[0].knowledgeFacts).toHaveLength(0);
    expect(result.issues.some((issue) => issue.message.includes("對應不到"))).toBe(
      true,
    );
  });

  it("對應的原子命題不是已核定時略過", () => {
    const result = validateArticlePack(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
            source_paragraph_id: "P-004",
            source_quote: "作用於昆蟲神經系統的鈉離子通道",
            status: "pending",
          },
        ],
      }),
    );

    expect(result.articles[0].knowledgeFacts).toHaveLength(0);
    expect(
      result.issues.some((issue) => issue.message.includes("目前是pending")),
    ).toBe(true);
  });
});

describe("整份無法使用時", () => {
  it("不是物件", () => {
    const result = validateArticlePack("字串");
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain("不是 JSON 物件");
  });

  it("沒有標題", () => {
    const result = validateArticlePack({ facts: [{ statement: "沒有來源" }] });
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain("缺少文章標題");
  });

  it("沒有原子命題", () => {
    const result = validateArticlePack({ source: { title: "空的" } });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("沒有任何原子命題")),
    ).toBe(true);
  });
});

/**
 * 駁回的原子命題不匯入。
 *
 * 起因：使用者匯入另一個 AI 產出的原子命題包，包內已標為駁回的原子命題仍被建成
 * 候選原子命題，之後在審核清單被全選批次核定，一起寫進了正式原子命題庫。
 * 根因有兩處，這裡守住入口這一處：駁回的原子命題根本不該進資料庫。
 */
describe("駁回的原子命題不匯入", () => {
  it("標為駁回的原子命題不會變成候選原子命題", () => {
    const result = validateArticlePack({
      source: { title: "含駁回" },
      document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
      facts: [
        {
          ref: "F-1",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          source_paragraph_id: "P-004",
          source_quote: "作用於昆蟲神經系統的鈉離子通道",
          status: "approved",
        },
        {
          ref: "F-2",
          statement: "賽滅寧對人體有立即致命危險。",
          source_paragraph_id: "P-004",
          source_quote: "作用於昆蟲神經系統的鈉離子通道",
          status: "rejected",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.articles[0].candidates).toHaveLength(1);
    expect(result.articles[0].candidates[0].ref).toBe("F-1");
    expect(result.articles[0].droppedRejected).toEqual(["F-2"]);
    expect(result.summary.candidates).toBe(1);
    expect(result.summary.rejected).toBe(1);
  });

  it("中文的「駁回」「不通過」一樣不匯入", () => {
    for (const label of ["駁回", "已駁回", "不通過"]) {
      const result = validateArticlePack({
        source: { title: "中文駁回" },
        document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
        原子命題: [
          {
            ref: "F-1",
            敘述: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
            段落: "P-004",
            原文片段: "作用於昆蟲神經系統的鈉離子通道",
            審核狀態: label,
          },
        ],
      });

      expect(result.ok, label).toBe(false);
      expect(
        result.issues.some((issue) => issue.message.includes("全部標為駁回")),
        label,
      ).toBe(true);
    }
  });

  it("會告訴使用者略過了哪幾筆", () => {
    const result = validateArticlePack({
      source: { title: "含駁回" },
      document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
      facts: [
        {
          ref: "F-1",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          source_paragraph_id: "P-004",
          source_quote: "作用於昆蟲神經系統的鈉離子通道",
        },
        { ref: "F-2", statement: "駁回一", status: "rejected" },
        { ref: "F-3", statement: "駁回二", status: "rejected" },
      ],
    });

    const notice = result.issues.find((issue) =>
      issue.message.includes("略過 2 筆標為駁回"),
    );
    expect(notice).toBeDefined();
    expect(notice?.message).toContain("F-2");
    expect(notice?.message).toContain("F-3");
    // 駁回的原子命題不必有可對應的段落，不該因此產生錯誤。
    expect(result.issues.some((issue) => issue.level === "error")).toBe(false);
  });

  it("駁回的原子命題不會被寫成正式原子命題", () => {
    const result = validateArticlePack({
      source: { title: "含駁回" },
      document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
      facts: [
        {
          ref: "F-1",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          source_paragraph_id: "P-004",
          source_quote: "作用於昆蟲神經系統的鈉離子通道",
          status: "rejected",
        },
        {
          ref: "F-2",
          statement: "賽滅寧屬於合成除蟲菊精類殺蟲劑。",
          source_paragraph_id: "P-004",
          source_quote: "賽滅寧",
          status: "approved",
        },
      ],
      knowledge_facts: [{ candidate_ref: "F-1" }, { candidate_ref: "F-2" }],
    });

    const refs = result.articles[0].knowledgeFacts.map(
      (fact) => fact.candidate_fact_id,
    );
    expect(refs).not.toContain("F-1");
  });
});

/**
 * 原子命題的分類：九類、可複選。
 *
 * 九類同時涵蓋知識內容、事件類型與治理層級，彼此本來就會重疊，
 * 所以匯入時不強迫單選，也不把認不得的值回落成某一類。
 */
describe("命題分類可複選", () => {
  function withTypes(types: unknown) {
    return validateArticlePack({
      source: { title: "分類" },
      document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
      facts: [
        {
          ref: "C001",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_id: "P-004",
          quote: "作用於昆蟲神經系統的鈉離子通道",
          proposition_types: types,
        },
      ],
    });
  }

  it("一條命題可以有多個分類", () => {
    const result = withTypes(["substance_property", "toxicology_mechanism"]);
    expect(result.articles[0].candidates[0].proposition_types).toEqual([
      "substance_property",
      "toxicology_mechanism",
    ]);
  });

  it("沒填就是未分類，不硬塞一個類別", () => {
    for (const value of [undefined, [], ""]) {
      const result = withTypes(value);
      expect(result.ok, String(value)).toBe(true);
      expect(result.articles[0].candidates[0].proposition_types).toEqual([]);
    }
  });

  it("中文寫法都認得，包含九類的全名", () => {
    const result = withTypes([
      "物質與物理化學性質",
      "化學基本概念",
      "事件",
      "化學署主題",
      "毒理與反應機制",
      "國內治理政策",
      "國外治理政策",
      "研究與期刊",
      "醫學健康建議",
    ]);
    expect(result.articles[0].candidates[0].proposition_types).toEqual([
      "substance_property",
      "chemistry_concept",
      "event",
      "agency_topic",
      "toxicology_mechanism",
      "domestic_policy",
      "foreign_policy",
      "research_literature",
      "health_advice",
    ]);
  });

  it("寫成一個字串、用頓號或斜線分隔也可以", () => {
    for (const value of ["物質、毒理", "物質／毒理", "物質,毒理"]) {
      const result = withTypes(value);
      expect(result.articles[0].candidates[0].proposition_types, value).toEqual([
        "substance_property",
        "toxicology_mechanism",
      ]);
    }
  });

  it("舊的六類寫法仍然匯得進來", () => {
    const result = withTypes(["substance", "policy", "topic"]);
    expect(result.articles[0].candidates[0].proposition_types).toEqual([
      "substance_property",
      "domestic_policy",
      "agency_topic",
    ]);
  });

  it("認不得的只丟掉那一個並回報，其餘照常匯入", () => {
    const result = withTypes(["外星分類", "毒理"]);
    expect(result.articles[0].candidates[0].proposition_types).toEqual([
      "toxicology_mechanism",
    ]);
    expect(result.issues.some((issue) => issue.message.includes("外星分類"))).toBe(
      true,
    );
  });

  it("重複的分類只留一份", () => {
    const result = withTypes(["物質", "substance_property", "物質與物理化學性質"]);
    expect(result.articles[0].candidates[0].proposition_types).toEqual([
      "substance_property",
    ]);
  });

  it("舊的「其他」代表沒有分類，不算辨識失敗", () => {
    const result = withTypes(["other"]);
    expect(result.articles[0].candidates[0].proposition_types).toEqual([]);
    expect(result.issues.some((issue) => issue.message.includes("無法辨識"))).toBe(
      false,
    );
  });
});

/**
 * 沒寫段落編號時不可以「猜」一個。
 *
 * 起因：真實的原子命題包裡有 33 筆是從外部文獻整理的，沒有 paragraph_id。
 * 原本的做法是「第 n 筆就當作 P-00n」，結果其中兩筆剛好撞上存在的段號，
 * 被掛到完全無關的段落上——一句講內分泌疾病症狀的話被掛到圖片說明那一段，
 * 而且引句會變成那一整段。段落編號是可回溯性的一環，猜錯比留白嚴重得多。
 */
describe("沒有段落編號時不猜段落", () => {
  const chunks = [
    { paragraph_id: "P-001", text: PARAGRAPH },
    { paragraph_id: "P-002", text: "第二段：與賽滅寧完全無關的圖片說明。" },
    { paragraph_id: "P-003", text: "第三段：另一段無關的文字內容說明。" },
  ];

  it("沒寫段落也沒自帶原文的，一律跳過並說明原因", () => {
    const result = validateArticlePack({
      source: { title: "缺段落" },
      document_chunks: chunks,
      facts: [
        {
          ref: "F001",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_id: "P-001",
          quote: "作用於昆蟲神經系統的鈉離子通道",
        },
        // 這一筆若照索引推算會變成 P-002，掛到完全無關的段落。
        { ref: "F002", statement: "這句話出自另一份文獻，本文沒有。" },
        { ref: "F003", statement: "這句話也出自另一份文獻。" },
      ],
    });

    expect(result.articles[0].candidates.map((c) => c.ref)).toEqual(["F001"]);

    const skipped = result.issues.filter((issue) => issue.level === "error");
    expect(skipped).toHaveLength(2);
    for (const issue of skipped) {
      expect(issue.message).toContain("沒有指定段落");
    }
  });

  it("自帶原文時仍然可以不寫段落編號", () => {
    const result = validateArticlePack({
      source: { title: "自帶原文" },
      facts: [
        {
          ref: "F001",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_text: PARAGRAPH,
          quote: "作用於昆蟲神經系統的鈉離子通道",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.articles[0].candidates[0].source_quote).toBe(
      "作用於昆蟲神經系統的鈉離子通道",
    );
  });
});

/**
 * 用別名對上不是「無法辨識」。
 *
 * 起因：一份 90 筆的原子命題包把 risk_level 寫成「中」「高」、status 寫成
 * 「核定」「待審核」——全部都是支援的寫法，卻產生一百多條
 * 「無法辨識」警告，把真正需要看的 33 筆錯誤埋掉了。
 */
describe("別名對上時不發警告", () => {
  it("中文的風險等級與狀態不會被當成無法辨識", () => {
    const result = validateArticlePack({
      source: { title: "中文列舉值" },
      document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
      facts: [
        {
          ref: "F001",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_id: "P-004",
          quote: "作用於昆蟲神經系統的鈉離子通道",
          risk_level: "高",
          status: "核定",
        },
      ],
      review_records: [{ candidate_fact_id: "F001", action: "核定" }],
    });

    expect(result.articles[0].candidates[0].risk_level).toBe("high");
    expect(result.articles[0].candidates[0].status).toBe("approved");
    expect(
      result.issues.filter((issue) => issue.message.includes("無法辨識")),
    ).toEqual([]);
  });

  it("真的認不得時才警告", () => {
    const result = validateArticlePack({
      source: { title: "認不得" },
      document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
      facts: [
        {
          ref: "F001",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_id: "P-004",
          quote: "作用於昆蟲神經系統的鈉離子通道",
          risk_level: "爆表",
        },
      ],
    });

    expect(result.articles[0].candidates[0].risk_level).toBe("medium");
    expect(
      result.issues.some((issue) => issue.message.includes("risk_level 無法辨識")),
    ).toBe(true);
  });

  it("把狀態寫進 action 欄位時對應到退回待審核", () => {
    const result = validateArticlePack({
      source: { title: "狀態當動作" },
      document_chunks: [{ paragraph_id: "P-004", text: PARAGRAPH }],
      facts: [
        {
          ref: "F001",
          statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          paragraph_id: "P-004",
          quote: "作用於昆蟲神經系統的鈉離子通道",
        },
      ],
      review_records: [{ candidate_fact_id: "F001", action: "待審核" }],
    });

    expect(result.articles[0].reviews[0].action).toBe("reopen");
    expect(
      result.issues.some((issue) => issue.message.includes("審核動作無法辨識")),
    ).toBe(false);
  });
});
