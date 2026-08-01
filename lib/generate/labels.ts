import type { DraftStatus } from "@/lib/supabase/types";

export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  draft: "草稿",
  edited: "已修改",
  final: "已定稿",
  blocked: "有紅色句子，已阻擋",
};

export const DRAFT_STATUS_CLASS: Record<DraftStatus, string> = {
  draft: "bg-blue-100 text-blue-800",
  edited: "bg-purple-100 text-purple-800",
  final: "bg-emerald-100 text-emerald-800",
  blocked: "bg-red-100 text-red-800",
};

export const AUDIENCE_OPTIONS = [
  "一般民眾",
  "家長",
  "孕婦與育齡女性",
  "學生",
  "媒體記者",
  "第一線人員",
];

export const TONE_OPTIONS = ["平實", "口語", "正式", "安撫"];
