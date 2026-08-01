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
 * 「嚴」= 引句對不上原文的事實一律退回待審核，不會被當成已核定。
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
        knowledge_type: "substance",
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
  it("接受精簡寫法：source + facts + 事實自帶原文", () => {
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
      事實: [
        {
          敘述: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
          段落: "P-004",
          段落原文: PARAGRAPH,
          原文片段: "作用於昆蟲神經系統的鈉離子通道",
          審核狀態: "駁回",
          風險等級: "高",
          知識類型: "物質",
        },
      ],
    });

    const candidate = result.articles[0].candidates[0];
    expect(candidate.status).toBe("rejected");
    expect(candidate.risk_level).toBe("high");
    expect(candidate.knowledge_type).toBe("substance");
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
            knowledge_type: "外星分類",
            risk_level: "爆表",
            status: "不知道",
          },
        ],
        knowledge_facts: [],
      }),
    );

    expect(result.ok).toBe(true);
    const candidate = result.articles[0].candidates[0];
    expect(candidate.knowledge_type).toBe("other");
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

  it("退回整段的事實不會產生正式事實", () => {
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
  it("一筆事實沒有原文時只跳過該筆，其餘照常匯入", () => {
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

  it("段落文字是佔位符時，事實可用自帶原文救回來", () => {
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

  it("完全沒有原文時該筆跳過，整篇沒有事實才判定不可匯入", () => {
    const result = validateArticlePack(
      pack({
        document_chunks: [
          { paragraph_id: "P-004", text: "$resolve_source_paragraph(P-004)" },
        ],
        candidate_facts: [
          {
            ref: "C001",
            statement: "沒有任何原文可以對照的事實。",
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

describe("正式事實", () => {
  it("對應不到事實時只略過，不擋下整包", () => {
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

  it("對應的事實不是已核定時略過", () => {
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

  it("沒有事實", () => {
    const result = validateArticlePack({ source: { title: "空的" } });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("沒有任何事實")),
    ).toBe(true);
  });
});
