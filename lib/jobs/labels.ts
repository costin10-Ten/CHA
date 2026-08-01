import type { JobStatus, SourceStatus, SourceType } from "@/lib/supabase/types";

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "等待中",
  processing: "處理中",
  completed: "已完成",
  failed: "失敗",
  retrying: "重試中",
  cancelled: "已取消",
};

export const JOB_TYPE_LABEL: Record<string, string> = {
  parse_document: "文件解析",
  extract_facts: "候選事實抽取",
  generate_embeddings: "向量產生",
  verify_answer: "回答驗證",
  generate_content: "素材產製",
  scheduled_update: "排程更新",
};

export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  pending: "等待處理",
  processing: "解析中",
  ready: "已完成",
  failed: "失敗",
  archived: "已封存",
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  text: "貼入文字",
  file: "上傳檔案",
  url: "網址",
};

export const SOURCE_STATUS_CLASS: Record<SourceStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-800",
  ready: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  archived: "bg-slate-100 text-slate-500",
};

export const JOB_STATUS_CLASS: Record<JobStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  retrying: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-100 text-slate-500",
};

/** 終態工作不需要再輪詢。 */
export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
