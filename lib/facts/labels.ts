import type {
  CandidateStatus,
  KnowledgeType,
  RiskLevel,
} from "@/lib/supabase/types";

export const KNOWLEDGE_TYPE_LABEL: Record<KnowledgeType, string> = {
  substance: "物質",
  concept: "概念",
  policy: "法規政策",
  event: "事件",
  topic: "主題",
  other: "其他",
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "低風險",
  medium: "中風險",
  high: "高風險",
};

export const RISK_LEVEL_CLASS: Record<RiskLevel, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  pending: "待審核",
  approved: "已核定",
  rejected: "已駁回",
  needs_fix: "待修正",
  merged: "已合併",
  split: "已拆分",
};

export const CANDIDATE_STATUS_CLASS: Record<CandidateStatus, string> = {
  pending: "bg-blue-100 text-blue-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  needs_fix: "bg-amber-100 text-amber-800",
  merged: "bg-slate-100 text-slate-700",
  split: "bg-slate-100 text-slate-700",
};

/** 自動品質檢查標記的中文說明，與 supabase/functions/_shared/quality.ts 對應。 */
export const QUALITY_FLAG_LABEL: Record<string, string> = {
  missing_quote: "缺少原文片段",
  quote_not_in_source: "原文片段不在來源中",
  number_mismatch: "數字或單位與原文不一致",
  incomplete_subject: "主詞不完整（以指代詞開頭）",
  multi_proposition: "一句包含多個命題",
  condition_lost: "條件或限制可能遺失",
  certainty_escalated: "可能性被改寫成確定語氣",
  inference_suspected: "疑似推論而非原文陳述",
  duplicate: "疑似重複",
  contradiction: "疑似與其他事實矛盾",
  low_confidence: "模型信心偏低",
};

export function qualityFlagLabel(flag: string): string {
  return QUALITY_FLAG_LABEL[flag] ?? flag;
}

export const CONDITION_LABEL: Record<string, string> = {
  population: "族群",
  exposure_route: "暴露途徑",
  dose: "劑量",
  duration: "持續時間",
  location: "地點",
  timeframe: "時間範圍",
};
