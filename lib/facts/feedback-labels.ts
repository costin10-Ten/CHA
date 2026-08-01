import type { FeedbackType } from "@/lib/supabase/types";

/** 回報 AI 抽取問題時的類型。順序即介面上的顯示順序。 */
export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = {
  beyond_source: "超出原文：說了原文沒有的內容",
  condition_lost: "條件遺失：族群、劑量或時間被省略",
  number_error: "數字錯誤：數值、單位或年份與原文不符",
  certainty_escalated: "語氣被放大：可能性被寫成確定",
  wrong_subject: "主詞錯誤：主體抓錯或不完整",
  bad_sentence_split: "切句錯誤：一句包含多件事或被切斷",
  quote_mismatch: "原文片段對不上：引用的句子不在原文中",
  other: "其他",
};

export const FEEDBACK_TYPE_SHORT: Record<FeedbackType, string> = {
  beyond_source: "超出原文",
  condition_lost: "條件遺失",
  number_error: "數字錯誤",
  certainty_escalated: "語氣被放大",
  wrong_subject: "主詞錯誤",
  bad_sentence_split: "切句錯誤",
  quote_mismatch: "原文對不上",
  other: "其他",
};
