import { describe, expect, it } from "vitest";

import {
  csvCell,
  documentToMarkdown,
  exportFilename,
  factsToCsv,
  factsToJson,
  factsToMarkdown,
  isExportFormat,
  mappingRows,
  mappingToCsv,
  mappingToMarkdown,
  serializeFacts,
  type ExportBundle,
  type ExportFact,
  type ExportSource,
} from "@/lib/export/serialize";

const SOURCE: ExportSource = {
  id: "src-1",
  title: "示範文件，含逗號",
  source_type: "text",
  origin_url: "https://example.test/a",
  content_hash: "hash-1",
  created_at: "2026-01-01T00:00:00.000Z",
};

const FACT: ExportFact = {
  id: "fact-1",
  statement: '孕婦每週攝取旗魚不宜超過 35 公克，並注意"其他"魚種。',
  subject: "孕婦",
  predicate: "不宜超過",
  object: "35 公克",
  proposition_types: ["substance_property"],
  risk_level: "medium",
  status: "active",
  version: 2,
  conditions: { population: "孕婦", dose: "35 公克", location: null },
  source_id: "src-1",
  source_paragraph_id: "P-001",
  source_quote: "孕婦每週攝取旗魚不宜超過 35 公克。",
  created_at: "2026-01-02T00:00:00.000Z",
};

const BUNDLE: ExportBundle = {
  facts: [FACT],
  sources: [SOURCE],
  exportedAt: "2026-02-01T00:00:00.000Z",
};

describe("CSV 逸出", () => {
  it("含逗號、引號或換行的欄位會被引號包起來", () => {
    expect(csvCell("普通")).toBe("普通");
    expect(csvCell("有,逗號")).toBe('"有,逗號"');
    expect(csvCell('有"引號"')).toBe('"有""引號"""');
    expect(csvCell("有\n換行")).toBe('"有\n換行"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("物件欄位序列化成 JSON 而不是 [object Object]", () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe("原子命題匯出", () => {
  it("CSV 帶有來源標題與網址，且條件被攤平", () => {
    const csv = factsToCsv(BUNDLE);
    const [header, row] = csv.split("\r\n");

    expect(header).toContain("source_title");
    expect(header).toContain("source_quote");
    expect(row).toContain("population=孕婦");
    // 值為 null 的條件不列出。
    expect(row).not.toContain("location=");
    expect(row).toContain("示範文件");
  });

  it("JSON 同時輸出來源與原子命題，可完整還原對照關係", () => {
    const parsed = JSON.parse(factsToJson(BUNDLE));

    expect(parsed.fact_count).toBe(1);
    expect(parsed.sources[0].id).toBe("src-1");
    expect(parsed.facts[0].source_paragraph_id).toBe("P-001");
    expect(parsed.facts[0].source_quote).toBeTruthy();
  });

  it("Markdown 依來源分組並附上原文片段", () => {
    const markdown = factsToMarkdown(BUNDLE);

    expect(markdown).toContain("## 示範文件，含逗號");
    expect(markdown).toContain("原文片段：");
    expect(markdown).toContain("P-001");
  });

  it("每一種格式都能輸出非空內容", () => {
    for (const format of ["json", "csv", "markdown"] as const) {
      expect(serializeFacts(BUNDLE, format).length).toBeGreaterThan(0);
    }
  });
});

describe("原子命題與來源對照表", () => {
  it("每一列都指出原子命題出自哪一份文件的哪一段", () => {
    const [row] = mappingRows(BUNDLE);

    expect(row.fact_id).toBe("fact-1");
    expect(row.source_title).toBe("示範文件，含逗號");
    expect(row.paragraph_id).toBe("P-001");
    expect(row.content_hash).toBe("hash-1");
  });

  it("CSV 與 Markdown 都可輸出，且 Markdown 逸出表格分隔字元", () => {
    expect(mappingToCsv(BUNDLE)).toContain("fact_id");

    const withPipe: ExportBundle = {
      ...BUNDLE,
      facts: [{ ...FACT, statement: "含有 | 的敘述" }],
    };
    expect(mappingToMarkdown(withPipe)).toContain("含有 \\| 的敘述");
  });
});

describe("單篇文件匯出", () => {
  it("包含原文段落與由本文產生的原子命題", () => {
    const markdown = documentToMarkdown({
      ...BUNDLE,
      source: SOURCE,
      paragraphs: [
        { paragraph_id: "P-001", text: "孕婦每週攝取旗魚不宜超過 35 公克。" },
      ],
    });

    expect(markdown).toContain("# 示範文件，含逗號");
    expect(markdown).toContain("**P-001**");
    expect(markdown).toContain("由本文產生的正式原子命題（1 筆）");
  });
});

describe("格式與檔名", () => {
  it("只接受支援的格式", () => {
    expect(isExportFormat("json")).toBe(true);
    expect(isExportFormat("xlsx")).toBe(false);
  });

  it("檔名帶日期與副檔名，且不含路徑分隔字元", () => {
    const name = exportFilename("knowledge/facts", "csv", new Date("2026-03-04"));
    expect(name).toBe("knowledge-facts-2026-03-04.csv");
    expect(name).not.toContain("/");
  });
});
