import type {
  CandidateStatus,
  PropositionType,
  RiskLevel,
} from "@/lib/supabase/types";

/**
 * 原子命題的九類分類。
 *
 * 這九類同時涵蓋「知識內容」「事件類型」與「治理層級」三個面向，
 * 彼此本來就會重疊——例如一條講國內法規如何限制某物質的命題，
 * 同時屬於「國內治理政策」與「物質與物理化學性質」。
 * 因此一條命題可以有多個分類，不強迫單選。
 */
export const PROPOSITION_TYPE_LABEL: Record<PropositionType, string> = {
  substance_property: "物質與物理化學性質",
  chemistry_concept: "化學基本概念",
  event: "事件",
  agency_topic: "化學署主題",
  toxicology_mechanism: "毒理與反應機制",
  domestic_policy: "國內治理政策",
  foreign_policy: "國外治理政策",
  research_literature: "研究與期刊",
  health_advice: "醫學健康建議",
};

/** 分類本身帶有的限制，顯示在選單旁提醒審核者。 */
export const PROPOSITION_TYPE_NOTE: Partial<Record<PropositionType, string>> = {
  health_advice: "須為政府機關來源",
};

export const PROPOSITION_TYPE_CLASS: Record<PropositionType, string> = {
  substance_property: "bg-sky-100 text-sky-800",
  chemistry_concept: "bg-sky-100 text-sky-800",
  event: "bg-violet-100 text-violet-800",
  agency_topic: "bg-violet-100 text-violet-800",
  toxicology_mechanism: "bg-teal-100 text-teal-800",
  domestic_policy: "bg-indigo-100 text-indigo-800",
  foreign_policy: "bg-indigo-100 text-indigo-800",
  research_literature: "bg-slate-100 text-slate-700",
  health_advice: "bg-rose-100 text-rose-800",
};

/** 未分類時顯示這個，不要顯示成「其他」——那會看起來像已經分過類。 */
export const UNCATEGORIZED_LABEL = "未分類";

export function propositionTypeLabels(types: PropositionType[]): string[] {
  return types.length === 0
    ? [UNCATEGORIZED_LABEL]
    : types.map((type) => PROPOSITION_TYPE_LABEL[type] ?? type);
}

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
  health_advice_source_not_gov: "醫學健康建議但來源不是政府機關",
  uncategorized: "尚未分類",
  condition_lost: "條件或限制可能遺失",
  certainty_escalated: "可能性被改寫成確定語氣",
  inference_suspected: "疑似推論而非原文陳述",
  duplicate: "疑似重複",
  contradiction: "疑似與其他原子命題矛盾",
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
