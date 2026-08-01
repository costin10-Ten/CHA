import { describe, expect, it } from "vitest";

import {
  candidateRef,
  chunkRef,
  isBindingPlaceholder,
  isContentPlaceholder,
  validateArticlePack,
} from "@shared/article-pack.ts";

/**
 * 文章包驗證。
 *
 * 重點是把「原文沒有附上」的檔案擋在匯入之前：
 * 沒有段落文字與原文引句，就無法判斷事實是否超出原文。
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

function errorsOf(input: unknown) {
  return validateArticlePack(input).issues.filter(
    (issue) => issue.level === "error",
  );
}

describe("佔位符分類", () => {
  it("綁定佔位符是合法的，由匯入流程解析", () => {
    for (const value of [
      "$auth.uid()",
      "$import_time",
      "$approval_time",
      "$sources[0].id",
      "$source_versions[0].id",
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
      "$resolve_paragraph_hash(P-004)",
    ]) {
      expect(isContentPlaceholder(value), value).toBe(true);
    }
  });

  it("參照可以是綁定寫法或直接寫 ref", () => {
    expect(candidateRef("$candidate_facts[C001].id")).toBe("C001");
    expect(candidateRef("C001")).toBe("C001");
    expect(candidateRef("$sources[0].id")).toBeNull();
    expect(chunkRef("$document_chunks[P-004].id")).toBe("P-004");
  });
});

describe("合法的文章包", () => {
  const result = validateArticlePack(pack());

  it("通過驗證並整理出可匯入的資料", () => {
    expect(result.ok).toBe(true);
    expect(result.pack?.document_chunks).toHaveLength(1);
    expect(result.pack?.candidate_facts[0].ref).toBe("C001");
    expect(result.pack?.review_records).toHaveLength(1);
    expect(result.pack?.knowledge_facts[0].candidate_fact_id).toBe("C001");
  });

  it("統計數量供匯入前確認", () => {
    expect(result.summary).toMatchObject({
      chunks: 1,
      candidates: 1,
      approved: 1,
      knowledgeFacts: 1,
      reviews: 1,
    });
  });
});

describe("擋下沒有原文的檔案", () => {
  it("段落文字是佔位符時擋下並說明怎麼改", () => {
    const issues = errorsOf(
      pack({
        document_chunks: [
          {
            paragraph_id: "P-004",
            text: "$resolve_source_paragraph(P-004)",
          },
        ],
      }),
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("佔位符");
    expect(issues[0].hint).toContain("真正的文字內容");
  });

  it("原文引句是佔位符時擋下", () => {
    const issues = errorsOf(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
            source_paragraph_id: "P-004",
            source_quote: "$resolve_quote(P-004,C001)",
            status: "approved",
          },
        ],
      }),
    );

    expect(issues.some((issue) => issue.where.includes("source_quote"))).toBe(true);
  });

  it("引句不在段落中時擋下", () => {
    const issues = errorsOf(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧會累積在人體。",
            source_paragraph_id: "P-004",
            source_quote: "賽滅寧會在人體大量累積",
            status: "pending",
          },
        ],
      }),
    );

    expect(issues[0].message).toContain("不在段落");
  });

  it("引用不存在的段落時擋下", () => {
    const issues = errorsOf(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統。",
            source_paragraph_id: "P-099",
            source_quote: "作用於昆蟲神經系統",
          },
        ],
      }),
    );

    expect(issues[0].message).toContain("找不到段落");
  });
});

describe("正式事實必須有審核依據", () => {
  it("對應的候選事實不是已核定時擋下", () => {
    const issues = errorsOf(
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

    expect(issues[0].message).toContain("不是 approved");
  });

  it("對應不到候選事實時擋下", () => {
    const issues = errorsOf(
      pack({
        knowledge_facts: [
          {
            ref: "F001",
            candidate_fact_id: "$candidate_facts[C999].id",
            statement: "任何內容",
          },
        ],
      }),
    );

    expect(issues[0].message).toContain("對應不到候選事實");
  });

  it("已核定但沒有正式事實時只提醒，不擋", () => {
    const result = validateArticlePack(pack({ knowledge_facts: [] }));

    expect(result.ok).toBe(true);
    expect(
      result.issues.some(
        (issue) => issue.level === "warning" && issue.message.includes("沒有對應"),
      ),
    ).toBe(true);
  });
});

describe("列舉值與結構", () => {
  it("不合法的列舉值被擋下", () => {
    const risk = errorsOf(
      pack({
        candidate_facts: [
          {
            ref: "C001",
            statement: "賽滅寧作用於昆蟲神經系統的鈉離子通道。",
            source_paragraph_id: "P-004",
            source_quote: "作用於昆蟲神經系統的鈉離子通道",
            risk_level: "extreme",
          },
        ],
      }),
    );
    expect(risk[0].where).toContain("risk_level");

    const action = errorsOf(
      pack({
        review_records: [
          { candidate_fact_id: "C001", action: "核定", to_status: "approved" },
        ],
      }),
    );
    expect(action[0].where).toContain("action");
  });

  it("段落編號重複被擋下", () => {
    const issues = errorsOf(
      pack({
        document_chunks: [
          { paragraph_id: "P-004", text: PARAGRAPH },
          { paragraph_id: "P-004", text: "另一段" },
        ],
      }),
    );
    expect(issues[0].message).toContain("重複");
  });

  it("不是物件或沒有來源時給明確訊息", () => {
    expect(errorsOf("字串")[0].message).toContain("不是 JSON 物件");
    expect(errorsOf(pack({ sources: [] }))[0].where).toBe("sources");
  });
});
