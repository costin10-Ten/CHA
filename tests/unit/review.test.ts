import { describe, expect, it } from "vitest";

import {
  ACTION_RESULT_STATUS,
  MAX_STATEMENT_LENGTH,
  BATCH_REVIEWABLE_STATUSES,
  assertActionAllowed,
  buildChanges,
  canApplyAction,
  isBatchApprovable,
  isBatchReviewable,
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

  /**
   * 起因：匯入的事實包裡有已駁回的事實，在審核清單被全選後批次核定，
   * 一步就寫進了正式事實庫。推翻一個「這句話不成立」的判斷，
   * 應該要先退回待審核、重新看過。
   */
  it("已駁回不能一步核定，必須先退回待審核", () => {
    expect(canApplyAction("rejected", "approve")).toBe(false);
    expect(canApplyAction("rejected", "approve_with_edit")).toBe(false);
    expect(canApplyAction("rejected", "reopen")).toBe(true);
    // 退回之後才走得通。
    expect(canApplyAction("pending", "approve")).toBe(true);
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

describe("isBatchReviewable", () => {
  /**
   * 批次操作只能作用於「還沒做決定」的候選事實。
   * 單筆審核頁看得到目前狀態、要按到那一筆，可以推翻決定；
   * 一次幾十筆的批次動作不該有這個能力。
   */
  it("只有待審核與待確認可以批次操作", () => {
    expect(BATCH_REVIEWABLE_STATUSES).toEqual(["pending", "needs_fix"]);
    expect(isBatchReviewable("pending")).toBe(true);
    expect(isBatchReviewable("needs_fix")).toBe(true);
  });

  it("已做過決定的一律排除在批次之外", () => {
    for (const status of [
      "approved",
      "rejected",
      "merged",
      "split",
    ] as CandidateStatus[]) {
      expect(isBatchReviewable(status), status).toBe(false);
    }
  });

  it("可批次核定的一定也是可批次操作的", () => {
    const statuses: CandidateStatus[] = [
      "pending",
      "approved",
      "rejected",
      "needs_fix",
      "merged",
      "split",
    ];
    for (const status of statuses) {
      if (
        isBatchApprovable({
          status,
          risk_level: "low",
          quality_flags: [],
        } as Parameters<typeof isBatchApprovable>[0])
      ) {
        expect(isBatchReviewable(status), status).toBe(true);
      }
    }
  });
});
