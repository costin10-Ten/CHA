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
import {
  JOB_STATUS_CLASS,
  JOB_STATUS_LABEL,
  formatDateTime,
} from "@/lib/jobs/labels";
import { getOrCreateProfile } from "@/lib/profile";
import { getSourceStats } from "@/lib/sources/queries";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * 統計數字全部來自資料庫查詢，不放任何無資料來源的假數字。
 * 尚未建立的資料表（候選事實、核定事實等）會在對應 Phase 完成後接上。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/dashboard");

  const supabase = await createClient();
  const [profile, stats, recentJobs] = await Promise.all([
    getOrCreateProfile(user.id),
    getSourceStats(),
    supabase
      .from("processing_jobs")
      .select("id, job_type, status, progress, created_at, last_error")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const jobs = recentJobs.data ?? [];

  return (
    <AppShell
      title="Dashboard"
      description={`已登入：${user.email}`}
      actions={
        <Link href="/sources">
          <Button>匯入來源</Button>
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="文件總數" value={stats.total} />
          <StatTile label="解析完成" value={stats.ready} />
          <StatTile label="處理中" value={stats.pending} />
          <StatTile label="段落總數" value={stats.chunkCount} />
        </div>

        {stats.failed > 0 && (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            有 {stats.failed} 份文件解析失敗，請到
            <Link href="/sources" className="mx-1 underline">
              來源
            </Link>
            檢視錯誤訊息並重新解析。
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>最近處理工作</CardTitle>
              <CardDescription>背景佇列的最新五筆紀錄。</CardDescription>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <p className="text-sm text-slate-500">尚無背景工作。</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {jobs.map((job) => (
                    <li
                      key={job.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="truncate text-slate-800">
                        {job.job_type}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge className={JOB_STATUS_CLASS[job.status]}>
                          {JOB_STATUS_LABEL[job.status]}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {formatDateTime(job.created_at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>帳號</CardTitle>
              <CardDescription>來自 Supabase Auth 與 profiles。</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">User ID</dt>
                  <dd className="truncate font-mono text-xs text-slate-800">
                    {user.id}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">顯示名稱</dt>
                  <dd className="text-slate-800">
                    {profile?.display_name ?? "（未設定）"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">建立時間</dt>
                  <dd className="text-slate-800">
                    {profile ? formatDateTime(profile.created_at) : "—"}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 space-y-1 text-sm text-slate-700">
                <p className="font-medium text-slate-900">目前進度</p>
                <p>✅ Phase 1：Auth、profiles、RLS、CI</p>
                <p>✅ Phase 2：來源匯入、Storage 直傳、背景工作、文件版本</p>
                <p>⏳ Phase 3：候選事實抽取與自動品質檢查</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
