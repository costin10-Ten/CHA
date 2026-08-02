import { describe, expect, it } from "vitest";

import {
  CORRECTION_GOALS,
  FIELD_DOCS,
  IMMUTABLE_FIELDS,
  PACK_VERSION,
  buildCandidatePack,
  findImmutableViolations,
  parseCandidatePack,
  type PackFact,
} from "@shared/pack.ts";

const FACT: PackFact = {
  id: "cand-1",
  statement: "孕婦每週攝取旗魚不宜超過 35 公克。",
  subject: "孕婦",
  predicate: "不宜超過",
  object: "35 公克",
  proposition_types: ["substance_property"],
  risk_level: "medium",
  conditions: { population: "孕婦", dose: "35 公克" },
  source_quote: "孕婦每週攝取旗魚不宜超過 35 公克。",
  source_paragraph_id: "P-001",
  source_title: "示範文件",
  source_url: null,
  paragraph_text: "衛生單位建議，孕婦每週攝取旗魚不宜超過 35 公克。",
  quality_flags: [],
  quality_score: 100,
  status: "pending",
};

describe("待選原子命題包", () => {
  const pack = buildCandidatePack([FACT], { scope: "測試" });

  it("自帶欄位說明，且來源欄位標記為不可修改", () => {
    for (const field of IMMUTABLE_FIELDS) {
      if (field === "id") continue;
      expect(FIELD_DOCS[field], `缺少欄位說明：${field}`).toBeDefined();
      expect(FIELD_DOCS[field].可否修改).toBe("不可修改");
    }
    expect(pack.欄位說明.statement.可否修改).toBe("可修改");
  });

  it("寫明使用者要求的三項校正目標", () => {
    const goals = pack.校正目標.map((goal) => goal.目標);
    expect(goals).toContain("不聳動");
    expect(goals).toContain("部會權責正確");
    expect(goals).toContain("科學正確性");
    expect(CORRECTION_GOALS).toHaveLength(3);
  });

  it("部會權責的檢查項目列出具體主管機關並要求不確定就標記", () => {
    const goal = CORRECTION_GOALS.find((item) => item.目標 === "部會權責正確")!;
    const text = goal.檢查項目.join("\n");

    expect(text).toContain("食品藥物管理署");
    expect(text).toContain("農業部");
    expect(text).toContain("環境部");
    expect(goal.說明).toContain("待確認");
  });

  it("科學正確性禁止改動數值與把相關性寫成因果", () => {
    const goal = CORRECTION_GOALS.find((item) => item.目標 === "科學正確性")!;
    const text = goal.檢查項目.join("\n");

    expect(text).toContain("單位");
    expect(text).toContain("因果");
  });

  it("包含回填格式與版本，並附上原文段落供判斷", () => {
    expect(pack.pack_version).toBe(PACK_VERSION);
    expect(pack.回填格式.規則.join("\n")).toContain("id 必須原樣帶回");
    expect(pack.任務說明).toContain("不得使用你自己的知識");
    expect(pack.facts[0].paragraph_text).toBeTruthy();
    expect(pack.fact_count).toBe(1);
  });
});

describe("解析回填內容", () => {
  it("接受合法的回填", () => {
    const parsed = parseCandidatePack({
      pack_version: PACK_VERSION,
      facts: [
        {
          id: "cand-1",
          statement: "修正後的敘述。",
          risk_level: "low",
          verdict: "revised",
          correction_reason: "原句把可能寫成一定",
        },
      ],
    });

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.facts[0].verdict).toBe("revised");
    expect(parsed.facts[0].statement).toBe("修正後的敘述。");
  });

  it("缺少 id 的項目被拒絕", () => {
    const parsed = parseCandidatePack({ facts: [{ statement: "沒有 id" }] });

    expect(parsed.facts).toHaveLength(0);
    expect(parsed.errors[0]).toContain("缺少 id");
  });

  it("重複的 id 只採計第一筆", () => {
    const parsed = parseCandidatePack({
      facts: [
        { id: "cand-1", statement: "第一次" },
        { id: "cand-1", statement: "第二次" },
      ],
    });

    expect(parsed.facts).toHaveLength(1);
    expect(parsed.errors.join()).toContain("重複");
  });

  it("不合法的列舉值被拒絕", () => {
    const risk = parseCandidatePack({
      facts: [{ id: "cand-1", risk_level: "extreme" }],
    });
    expect(risk.facts).toHaveLength(0);
    expect(risk.errors.join()).toContain("risk_level");

    const verdict = parseCandidatePack({
      facts: [{ id: "cand-1", verdict: "approve" }],
    });
    expect(verdict.facts).toHaveLength(0);
    expect(verdict.errors.join()).toContain("verdict");
  });

  it("版本不符會提出警告", () => {
    const parsed = parseCandidatePack({
      pack_version: 99,
      facts: [{ id: "cand-1" }],
    });
    expect(parsed.errors.join()).toContain("pack_version");
  });

  it("不是物件或缺少 facts 時給明確訊息", () => {
    expect(parseCandidatePack("字串").errors[0]).toContain("不是 JSON 物件");
    expect(parseCandidatePack({}).errors.join()).toContain("缺少 facts");
  });
});

describe("不可修改欄位保護", () => {
  it("原文片段被改動時回報違規", () => {
    const violations = findImmutableViolations(
      { id: "cand-1", source_quote: "被竄改的原文" },
      FACT,
    );
    expect(violations).toContain("source_quote");
  });

  it("原樣帶回或未帶回都視為合法", () => {
    expect(
      findImmutableViolations(
        { id: "cand-1", source_quote: FACT.source_quote },
        FACT,
      ),
    ).toHaveLength(0);
    expect(findImmutableViolations({ id: "cand-1" }, FACT)).toHaveLength(0);
  });

  it("段落編號被改動時回報違規", () => {
    expect(
      findImmutableViolations({ id: "cand-1", source_paragraph_id: "P-999" }, FACT),
    ).toContain("source_paragraph_id");
  });
});
