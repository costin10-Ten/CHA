import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FEEDBACK_TYPE_SHORT } from "@/lib/facts/feedback-labels";
import { listHistory, type HistoryKind } from "@/lib/history/queries";
import {
  JOB_STATUS_CLASS,
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  formatDateTime,
} from "@/lib/jobs/labels";
import { getCurrentUser } from "@/lib/supabase/server";
import type { FeedbackType, JobStatus } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "處理歷程" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<HistoryKind, string> = {
  job: "背景工作",
  review: "審核動作",
  model_run: "模型呼叫",
  feedback: "抽取回報",
};

const KIND_CLASS: Record<HistoryKind, string> = {
  job: "bg-blue-100 text-blue-800",
  review: "bg-emerald-100 text-emerald-800",
  model_run: "bg-slate-100 text-slate-700",
  feedback: "bg-amber-100 text-amber-900",
};

const REVIEW_ACTION_LABEL: Record<string, string> = {
  approve: "核定",
  approve_with_edit: "修正後核定",
  reject: "駁回",
  needs_fix: "標記待確認",
  split: "拆分",
  merge: "合併",
  reextract: "重新抽取",
  reopen: "退回待審核",
  external_correction: "外部 LLM 校正回填",
};

const KINDS: HistoryKind[] = ["job", "review", "model_run", "feedback"];

function isKind(value: string | undefined): value is HistoryKind {
  return !!value && (KINDS as string[]).includes(value);
}

/** 依類型翻譯標題，讓時間線讀起來是中文而不是欄位值。 */
function titleOf(kind: HistoryKind, raw: string): string {
  if (kind === "job") return JOB_TYPE_LABEL[raw] ?? raw;
  if (kind === "review") return REVIEW_ACTION_LABEL[raw] ?? raw;
  if (kind === "feedback") {
    return FEEDBACK_TYPE_SHORT[raw as FeedbackType] ?? raw;
  }
  return raw;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/history");

  const params = await searchParams;
  const kind = isKind(params.kind) ? params.kind : undefined;

  let loadError: string | null = null;
  const entries = await listHistory({ kind, limit: 100 }).catch(
    (cause: unknown) => {
      loadError = cause instanceof Error ? cause.message : "讀取歷程失敗";
      return [];
    },
  );

  return (
    <AppShell
      title="處理歷程"
      description="背景工作、審核動作、模型呼叫與抽取回報的完整時間線。每一筆操作都留有紀錄。"
    >
      <div className="space-y-6">
        {loadError && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">無法讀取歷程</p>
            <p className="mt-1">{loadError}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Link
            href="/history"
            className={`rounded-full border px-3 py-1 text-xs ${
              kind
                ? "border-slate-300 text-slate-600 hover:bg-slate-100"
                : "border-slate-900 bg-slate-900 text-white"
            }`}
          >
            全部
          </Link>
          {KINDS.map((value) => (
            <Link
              key={value}
              href={`/history?kind=${value}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                kind === value
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-100"
              }`}
            >
              {KIND_LABEL[value]}
            </Link>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>最近 100 筆</CardTitle>
            <CardDescription>依時間由新到舊排列。</CardDescription>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <p className="text-sm text-slate-500">
                還沒有任何紀錄。匯入一份來源後就會開始累積。
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2 text-sm last:border-0"
                  >
                    <Badge className={KIND_CLASS[entry.kind]}>
                      {KIND_LABEL[entry.kind]}
                    </Badge>

                    {entry.href ? (
                      <Link
                        href={entry.href}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {titleOf(entry.kind, entry.title)}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900">
                        {titleOf(entry.kind, entry.title)}
                      </span>
                    )}

                    {entry.kind === "job" && entry.status && (
                      <Badge
                        className={JOB_STATUS_CLASS[entry.status as JobStatus]}
                      >
                        {JOB_STATUS_LABEL[entry.status as JobStatus] ??
                          entry.status}
                      </Badge>
                    )}

                    <span className="ml-auto text-xs text-slate-400">
                      {formatDateTime(entry.createdAt)}
                    </span>

                    {entry.detail && (
                      <span className="w-full text-xs break-words text-slate-600">
                        {entry.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
