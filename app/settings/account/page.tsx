import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SettingsNav } from "@/components/settings/settings-nav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardStats } from "@/lib/dashboard/queries";
import { formatDateTime } from "@/lib/jobs/labels";
import { getOrCreateProfile } from "@/lib/profile";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "帳號與資料" };
export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/settings/account");

  const [profile, stats] = await Promise.all([
    getOrCreateProfile(user.id).catch(() => null),
    getDashboardStats(),
  ]);

  return (
    <AppShell title="帳號與資料" description="帳號資訊、資料量與匯出備份入口。">
      <SettingsNav current="/settings/account" />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>帳號</CardTitle>
            <CardDescription>來自 Supabase Auth 與 profiles。</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Email">{user.email ?? "—"}</Row>
              <Row label="顯示名稱">{profile?.display_name ?? "（未設定）"}</Row>
              <Row label="User ID">
                <span className="font-mono text-xs break-all">{user.id}</span>
              </Row>
              <Row label="建立時間">
                {profile ? formatDateTime(profile.created_at) : "—"}
              </Row>
            </dl>

            <div className="mt-4">
              <SignOutButton />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>我的資料量</CardTitle>
            <CardDescription>
              全部資料都以 <code>owner_id</code> 隔離，RLS 保證只有你看得到。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Row label="來源文件">{stats.sources ?? "—"}</Row>
              <Row label="原文段落">{stats.chunks ?? "—"}</Row>
              <Row label="候選事實">{stats.candidates ?? "—"}</Row>
              <Row label="正式事實">{stats.knowledgeFacts ?? "—"}</Row>
              <Row label="現行向量">{stats.activeEmbeddings ?? "—"}</Row>
              <Row label="素材草稿">{stats.drafts ?? "—"}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>匯出與備份</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p>
              內容匯出（正式事實、對照表、單篇文件、待選事實包）在
              <Link href="/export" className="mx-1 underline">
                匯出
              </Link>
              頁。
            </p>
            <p className="text-xs text-slate-500">
              資料庫與 Storage 的完整備份、還原步驟寫在 <code>docs/BACKUP.md</code>
              ；備份需要 service key，只能在本機或 CI 執行。
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-slate-200 px-3 py-2">
      <dt className="shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium text-slate-900">
        {children}
      </dd>
    </div>
  );
}
