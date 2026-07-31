import type { CandidateStatus } from "@/lib/supabase/types";

/**
 * 審核流程的純邏輯：狀態轉換規則、輸入驗證與差異計算。
 * 不碰資料庫，方便完整單元測試。
 */

export type ReviewAction =
  | "approve"
  | "approve_with_edit"
  | "reject"
  | "needs_fix"
  | "split"
  | "merge"
  | "reextract"
  | "reopen";

export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  approve: "核定",
  approve_with_edit: "修正後核定",
  reject: "駁回",
  needs_fix: "標記待確認",
  split: "拆成多筆",
  merge: "合併",
  reextract: "重新抽取",
  reopen: "退回待審核",
};

/** 每個動作完成後候選事實的狀態。 */
export const ACTION_RESULT_STATUS: Record<ReviewAction, CandidateStatus | null> = {
  approve: "approved",
  approve_with_edit: "approved",
  reject: "rejected",
  needs_fix: "needs_fix",
  split: "split",
  merge: "merged",
  reextract: null, // 不改變單筆狀態，只排入抽取工作
  reopen: "pending",
};

/**
 * 允許的狀態轉換。
 * 已合併或已拆分的事實是歷史紀錄，不可再直接審核，只能退回待審核。
 */
const ALLOWED_ACTIONS: Record<CandidateStatus, ReviewAction[]> = {
  pending: [
    "approve",
    "approve_with_edit",
    "reject",
    "needs_fix",
    "split",
    "merge",
  ],
  needs_fix: ["approve", "approve_with_edit", "reject", "split", "merge", "reopen"],
  approved: ["reject", "needs_fix", "reopen"],
  rejected: ["reopen", "approve", "approve_with_edit"],
  merged: ["reopen"],
  split: ["reopen"],
};

export function canApplyAction(
  status: CandidateStatus,
  action: ReviewAction,
): boolean {
  if (action === "reextract") return true;
  return ALLOWED_ACTIONS[status].includes(action);
}

export function assertActionAllowed(
  status: CandidateStatus,
  action: ReviewAction,
): string | null {
  if (canApplyAction(status, action)) return null;
  return `狀態「${status}」不允許執行「${REVIEW_ACTION_LABEL[action]}」`;
}

export const MIN_STATEMENT_LENGTH = 5;
export const MAX_STATEMENT_LENGTH = 500;

export function validateStatement(statement: string): string | null {
  const trimmed = statement.trim();
  if (trimmed.length < MIN_STATEMENT_LENGTH) {
    return `事實敘述至少需要 ${MIN_STATEMENT_LENGTH} 個字`;
  }
  if (trimmed.length > MAX_STATEMENT_LENGTH) {
    return `事實敘述不可超過 ${MAX_STATEMENT_LENGTH} 個字`;
  }
  return null;
}

/** 拆分輸入：一行一筆。 */
export function parseSplitStatements(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function validateSplit(statements: string[]): string | null {
  if (statements.length < 2) return "拆分至少要有兩筆事實，每行一筆";
  for (const statement of statements) {
    const error = validateStatement(statement);
    if (error) return `「${statement.slice(0, 20)}」：${error}`;
  }
  return null;
}

export function validateMerge(ids: string[]): string | null {
  if (ids.length < 2) return "合併至少要選取兩筆候選事實";
  return null;
}

export interface EditableFields {
  statement: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  knowledge_type: string;
  risk_level: string;
  conditions: Record<string, string | null>;
}

/** 計算實際變更的欄位，寫入 review_records.changes 供追溯。 */
export function buildChanges(
  before: Partial<EditableFields>,
  after: Partial<EditableFields>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const from = before[key as keyof EditableFields];
    const to = after[key as keyof EditableFields];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes[key] = { from: from ?? null, to: to ?? null };
    }
  }

  return changes;
}

/** 批次核定的預設條件：低風險、無品質標記、仍待審核。 */
export function isBatchApprovable(fact: {
  status: CandidateStatus;
  risk_level: string;
  quality_flags: string[];
}): boolean {
  return (
    fact.status === "pending" &&
    fact.risk_level === "low" &&
    fact.quality_flags.length === 0
  );
}
