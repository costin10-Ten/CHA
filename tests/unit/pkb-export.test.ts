import { describe, expect, it } from "vitest";

import {
  PKB_USAGE_NOTICE,
  buildPkbExport,
  toPkbJsonl,
  toPkbMarkdown,
} from "@/lib/pkb/export";
import type { PkbItemRow } from "@/lib/supabase/types";

/**
 * 匯出給其他 LLM 用的檔案。
 *
 * 最重要的一件事：自製內容（模擬題、正式發想點）必須明確標示。
 * 不標示的話，使用者自己的發想會被模型當成既有事實引用回來。
 */

function item(overrides: Partial<PkbItemRow> = {}): PkbItemRow {
  return {
    id: "item-1",
    owner_id: "owner-1",
    import_batch_id: null,
    statement: "化學物質登錄制度由環境部化學物質管理署主管。",
    source_type: "domestic_law",
    source_label: "化學物質登錄辦法",
    source_url: "https://cha.gov.tw/law",
    source_note: null,
    is_self_authored: false,
    subject: "化學物質登錄制度",
    predicate: "主管機關",
    object: "環境部化學物質管理署",
    tags: ["登錄", "法規"],
    status: "active",
    approved_at: "2026-08-03T00:00:00Z",
    trashed_at: null,
    trash_reason: null,
    statement_hash: "hash-1",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const AT = "2026-08-03T12:00:00Z";

describe("Markdown 匯出", () => {
  const md = toPkbMarkdown([item()], AT);

  it("開頭有給模型看的使用說明", () => {
    expect(md).toContain(PKB_USAGE_NOTICE);
    expect(md).toContain("回答只能依據本檔的內容");
    expect(md).toContain("檔案裡找不到答案時，明說找不到");
  });

  it("依來源分類分組，並附上來源", () => {
    expect(md).toContain("## 國內法規");
    expect(md).toContain("化學物質登錄辦法");
    expect(md).toContain("https://cha.gov.tw/law");
  });

  it("有主體與關係時輸出圖譜關係", () => {
    expect(md).toContain("化學物質登錄制度 —主管機關→ 環境部化學物質管理署");
  });

  it("敘述裡的換行不會破壞清單結構", () => {
    const md2 = toPkbMarkdown([item({ statement: "第一行\n第二行" })], AT);
    expect(md2).toContain("- 第一行 第二行");
  });

  it("沒有資料時明說，不輸出空清單", () => {
    expect(toPkbMarkdown([], AT)).toContain("目前沒有已同意的原子知識");
  });
});

describe("自製內容一定要標示", () => {
  const selfItem = item({
    id: "item-2",
    statement: "如果登錄門檻下修，會不會影響中小企業？",
    source_type: "mock_question",
    source_label: "自己出的模擬題",
    source_url: null,
    is_self_authored: true,
  });

  it("Markdown 逐筆標【自製】並在小節標題註明", () => {
    const md = toPkbMarkdown([selfItem], AT);
    expect(md).toContain("## 模擬題（自製內容，非外部依據）");
    expect(md).toContain("- 【自製】如果登錄門檻下修");
  });

  it("使用說明講清楚自製內容不得當成事實引用", () => {
    expect(PKB_USAGE_NOTICE).toContain("不得當成既有事實或查證結果引用");
  });

  it("JSONL 帶 is_self_authored 欄位", () => {
    const lines = toPkbJsonl([selfItem], AT).trim().split("\n");
    const record = JSON.parse(lines[1]);
    expect(record.is_self_authored).toBe(true);
    expect(record.source_type_label).toBe("模擬題");
  });

  it("外部來源不會被誤標成自製", () => {
    const md = toPkbMarkdown([item()], AT);
    expect(md).not.toContain("【自製】");
    expect(md).not.toContain("非外部依據");
  });
});

describe("JSONL 匯出", () => {
  it("第一行是說明，其餘一行一筆", () => {
    const lines = toPkbJsonl([item(), item({ id: "item-2" })], AT)
      .trim()
      .split("\n");

    expect(lines).toHaveLength(3);
    const header = JSON.parse(lines[0]);
    expect(header.kind).toBe("pkb-export-header");
    expect(header.count).toBe(2);
    expect(header.usage).toBe(PKB_USAGE_NOTICE);

    for (const line of lines.slice(1)) {
      expect(JSON.parse(line).kind).toBe("knowledge");
    }
  });

  it("每一行都是合法 JSON，敘述含換行也不會壞掉", () => {
    const lines = toPkbJsonl([item({ statement: "含\n換行" })], AT)
      .trim()
      .split("\n");
    expect(() => lines.map((line) => JSON.parse(line))).not.toThrow();
    expect(JSON.parse(lines[1]).statement).toBe("含\n換行");
  });

  it("不含 owner_id 等內部欄位", () => {
    const record = JSON.parse(toPkbJsonl([item()], AT).trim().split("\n")[1]);
    expect(record.owner_id).toBeUndefined();
    expect(record.statement_hash).toBeUndefined();
    expect(record.import_batch_id).toBeUndefined();
  });
});

describe("buildPkbExport", () => {
  it("依格式分派", () => {
    expect(buildPkbExport([item()], "markdown", AT)).toContain("# 個人原子知識庫");
    expect(buildPkbExport([item()], "jsonl", AT)).toContain(
      '"kind":"pkb-export-header"',
    );
  });
});
