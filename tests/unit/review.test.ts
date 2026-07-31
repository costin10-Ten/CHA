import { describe, expect, it } from "vitest";

import {
  ACTION_RESULT_STATUS,
  MAX_STATEMENT_LENGTH,
  assertActionAllowed,
  buildChanges,
  canApplyAction,
  isBatchApprovable,
  parseSplitStatements,
  validateMerge,
  validateSplit,
  validateStatement,
  type ReviewAction,
} from "@/lib/facts/review";
import type { CandidateStatus } from "@/lib/supabase/types";

describe("canApplyAction", () => {
  it("待審核可以核定、修正、駁回、待確認、拆分與合併", () => {
    const actions: ReviewAction[] = [
      "approve",
      "approve_with_edit",
      "reject",
      "needs_fix",
      "split",
      "merge",
    ];
    for (const action of actions) {
      expect(canApplyAction("pending", action)).toBe(true);
    }
  });

  it("已核定不能再次核定，但可以駁回或退回待審核", () => {
    expect(canApplyAction("approved", "approve")).toBe(false);
    expect(canApplyAction("approved", "reject")).toBe(true);
    expect(canApplyAction("approved", "reopen")).toBe(true);
  });

  it("已合併與已拆分是歷史紀錄，只能退回待審核", () => {
    for (const status of ["merged", "split"] as CandidateStatus[]) {
      expect(canApplyAction(status, "approve")).toBe(false);
      expect(canApplyAction(status, "split")).toBe(false);
      expect(canApplyAction(status, "reopen")).toBe(true);
    }
  });

  it("重新抽取在任何狀態都允許", () => {
    for (const status of [
      "pending",
      "approved",
      "rejected",
      "needs_fix",
      "merged",
      "split",
    ] as CandidateStatus[]) {
      expect(canApplyAction(status, "reextract")).toBe(true);
    }
  });

  it("不允許時回傳可讀訊息", () => {
    expect(assertActionAllowed("approved", "approve")).toContain("不允許");
    expect(assertActionAllowed("pending", "approve")).toBeNull();
  });
});

describe("ACTION_RESULT_STATUS", () => {
  it("每個動作都對應到明確的結果狀態", () => {
    expect(ACTION_RESULT_STATUS.approve).toBe("approved");
    expect(ACTION_RESULT_STATUS.approve_with_edit).toBe("approved");
    expect(ACTION_RESULT_STATUS.reject).toBe("rejected");
    expect(ACTION_RESULT_STATUS.needs_fix).toBe("needs_fix");
    expect(ACTION_RESULT_STATUS.split).toBe("split");
    expect(ACTION_RESULT_STATUS.merge).toBe("merged");
    expect(ACTION_RESULT_STATUS.reopen).toBe("pending");
    // 重新抽取不改變單筆狀態
    expect(ACTION_RESULT_STATUS.reextract).toBeNull();
  });
});

describe("validateStatement", () => {
  it("拒絕過短敘述", () => {
    expect(validateStatement("太短")).toContain("至少");
  });

  it("拒絕過長敘述", () => {
    expect(validateStatement("字".repeat(MAX_STATEMENT_LENGTH + 1))).toContain(
      "不可超過",
    );
  });

  it("合法敘述回傳 null", () => {
    expect(validateStatement("氫氟酸接觸皮膚可能造成深層灼傷。")).toBeNull();
  });
});

describe("parseSplitStatements 與 validateSplit", () => {
  it("一行一筆並忽略空行", () => {
    expect(parseSplitStatements("第一筆事實。\n\n  第二筆事實。  \n")).toEqual([
      "第一筆事實。",
      "第二筆事實。",
    ]);
  });

  it("少於兩筆不允許拆分", () => {
    expect(validateSplit(["只有一筆事實。"])).toContain("至少要有兩筆");
  });

  it("任何一筆過短就擋下", () => {
    expect(validateSplit(["完整的一筆事實。", "短"])).toContain("至少");
  });

  it("合法拆分回傳 null", () => {
    expect(validateSplit(["第一筆事實內容。", "第二筆事實內容。"])).toBeNull();
  });
});

describe("validateMerge", () => {
  it("少於兩筆不能合併", () => {
    expect(validateMerge(["a"])).toContain("至少要選取兩筆");
    expect(validateMerge(["a", "b"])).toBeNull();
  });
});

describe("buildChanges", () => {
  it("只記錄真正變動的欄位", () => {
    const changes = buildChanges(
      { statement: "舊敘述", risk_level: "low", subject: "汞" },
      { statement: "新敘述", risk_level: "low", subject: "汞" },
    );

    expect(Object.keys(changes)).toEqual(["statement"]);
    expect(changes.statement).toEqual({ from: "舊敘述", to: "新敘述" });
  });

  it("null 與 undefined 視為相同，不算變動", () => {
    const changes = buildChanges({ subject: null }, { subject: undefined });
    expect(changes).toEqual({});
  });

  it("巢狀條件物件有變動時會記錄", () => {
    const changes = buildChanges(
      { conditions: { population: null } },
      { conditions: { population: "孕婦" } },
    );
    expect(changes.conditions).toBeDefined();
  });
});

describe("isBatchApprovable", () => {
  it("待審核、低風險且無標記才可批次核定", () => {
    expect(
      isBatchApprovable({
        status: "pending",
        risk_level: "low",
        quality_flags: [],
      }),
    ).toBe(true);
  });

  it.each([
    { status: "approved" as CandidateStatus, risk_level: "low", quality_flags: [] },
    { status: "pending" as CandidateStatus, risk_level: "high", quality_flags: [] },
    {
      status: "pending" as CandidateStatus,
      risk_level: "low",
      quality_flags: ["condition_lost"],
    },
  ])("不符合條件時排除：%o", (fact) => {
    expect(isBatchApprovable(fact)).toBe(false);
  });
});
