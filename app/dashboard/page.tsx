import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getApiUsage, getDashboardStats } from "@/lib/dashboard/queries";
import {
  JOB_STATUS_CLASS,
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  formatDateTime,
} from "@/lib/jobs/labels";
import { getOrCreateProfile } from "@/lib/profile";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * 統計數字全部來自資料庫查詢，不放任何無資料來源的假數字。
 * 查不到的項目顯示「—」而不是 0，避免把「查詢失敗」誤讀成「沒有資料」。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/dashboard");

  const supabase = await createClient();
  const [profile, stats, usage, recentJobs, recentAnswers] = await Promise.all([
    getOrCreateProfile(user.id).catch(() => null),
    getDashboardStats(),
    getApiUsage(),
    supabase
      .from("processing_jobs")
      .select("id, job_type, status, progress, created_at, last_error")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("answer_sessions")
      .select("id, question, created_at, publishable, unsupported_count")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const jobs = recentJobs.data ?? [];
  const answers = recentAnswers.data ?? [];

  return (
    <AppShell
      title="Dashboard"
      description={`已登入：${profile?.display_name ?? user.email}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/sources">
            <Button>匯入來源</Button>
          </Link>
          <Link href="/import">
            <Button variant="outline">匯入文章包</Button>
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="文件總數" value={stats.sources} href="/sources" />
          <StatTile label="候選事實" value={stats.candidates} href="/review" />
          <StatTile
            label="待審核"
            value={stats.pendingReview}
            href="/review?status=pending"
            highlight={(stats.pendingReview ?? 0) > 0}
          />
          <StatTile
            label="核定事實"
            value={stats.knowledgeFacts}
            href="/knowledge"
          />
          <StatTile
            label="高風險事實"
            value={stats.highRisk}
            href="/knowledge?risk=high"
          />
          <StatTile label="原文段落" value={stats.chunks} />
          <StatTile label="現行向量" value={stats.activeEmbeddings} />
          <StatTile label="素材草稿" value={stats.drafts} href="/generate" />
          <StatTile
            label="驗證失敗句數"
            value={stats.unsupportedSentences}
            href="/verify"
            danger={(stats.unsupportedSentences ?? 0) > 0}
          />
          <StatTile
            label="被阻擋的回答"
            value={stats.blockedAnswers}
            href="/verify"
            danger={(stats.blockedAnswers ?? 0) > 0}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>最近處理工作</CardTitle>
              <CardDescription>背景佇列的最新五筆紀錄。</CardDescription>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <p className="text-sm text-slate-500">還沒有背景工作。</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {jobs.map((job) => (
                    <li
                      key={job.id}
                      className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2 last:border-0"
                    >
                      <Badge className={JOB_STATUS_CLASS[job.status]}>
                        {JOB_STATUS_LABEL[job.status]}
                      </Badge>
                      <span className="text-slate-700">
                        {JOB_TYPE_LABEL[job.job_type] ?? job.job_type}
                      </span>
                      {job.status === "processing" && (
                        <span className="text-xs text-slate-500">
                          {job.progress}%
                        </span>
                      )}
                      <span className="ml-auto text-xs text-slate-400">
                        {formatDateTime(job.created_at)}
                      </span>
                      {job.last_error && (
                        <span className="w-full text-xs text-red-600">
                          {job.last_error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/history"
                className="mt-3 inline-block text-sm text-blue-700 underline"
              >
                檢視完整歷程
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>最近問答</CardTitle>
              <CardDescription>
                每一份回答都經過逐句驗證，紅色句子不會進入發布稿。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {answers.length === 0 ? (
                <p className="text-sm text-slate-500">
                  還沒有問答紀錄。到
                  <Link href="/ask" className="mx-1 underline">
                    問答
                  </Link>
                  提第一個問題。
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {answers.map((answer) => (
                    <li
                      key={answer.id}
                      className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2 last:border-0"
                    >
                      <Link
                        href={`/verify/${answer.id}`}
                        className="min-w-0 flex-1 truncate text-slate-800 hover:underline"
                      >
                        {answer.question}
                      </Link>
                      {answer.unsupported_count > 0 ? (
                        <Badge className="bg-red-100 text-red-800">
                          紅 {answer.unsupported_count}
                        </Badge>
                      ) : answer.publishable ? (
                        <Badge className="bg-emerald-100 text-emerald-800">
                          可發布
                        </Badge>
                      ) : null}
                      <span className="text-xs text-slate-400">
                        {formatDateTime(answer.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>API 用量概況</CardTitle>
            <CardDescription>
              最近 500 次模型呼叫。使用 Mock Provider 時不會產生費用。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <UsageTile label="呼叫次數" value={usage.runs} />
              <UsageTile label="輸入 tokens" value={usage.inputTokens} />
              <UsageTile label="輸出 tokens" value={usage.outputTokens} />
              <UsageTile label="失敗次數" value={usage.failures} />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              使用的 provider：
              {usage.providers.length > 0 ? usage.providers.join("、") : "尚無紀錄"}
              ．
              <Link href="/settings/models" className="ml-1 underline">
                模型設定
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatTile({
  label,
  value,
  href,
  highlight,
  danger,
}: {
  label: string;
  value: number | null;
  href?: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  const tone = danger
    ? "border-red-200 bg-red-50"
    : highlight
      ? "border-blue-200 bg-blue-50"
      : "border-slate-200 bg-white";

  const content = (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">
        {value === null ? "—" : value}
      </p>
    </div>
  );

  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}

function UsageTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">
        {value.toLocaleString("zh-TW")}
      </p>
    </div>
  );
}
