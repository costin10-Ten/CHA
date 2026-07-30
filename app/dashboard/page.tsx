import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOrCreateProfile } from "@/lib/profile";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

/**
 * Phase 1 的 Dashboard 只顯示已經真的存在於資料庫的資訊（帳號與 profile）。
 * 文件數、候選事實數等統計會在對應資料表於 Phase 2 之後建立時接上，
 * 不在此處放置無資料來源的假數字。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/dashboard");

  const profile = await getOrCreateProfile(user.id);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">已登入：{user.email}</p>
          </div>
          <SignOutButton />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>帳號</CardTitle>
              <CardDescription>來自 Supabase Auth 與 profiles。</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">User ID</dt>
                  <dd className="font-mono text-xs text-slate-800">{user.id}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">顯示名稱</dt>
                  <dd className="text-slate-800">
                    {profile?.display_name ?? "（未設定）"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">語系</dt>
                  <dd className="text-slate-800">{profile?.locale ?? "zh-TW"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">建立時間</dt>
                  <dd className="text-slate-800">
                    {profile
                      ? new Date(profile.created_at).toLocaleString("zh-TW")
                      : "—"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>目前進度</CardTitle>
              <CardDescription>Phase 1：基礎架構與登入。</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-slate-700">
                <li>✅ Next.js App Router + TypeScript strict + Tailwind</li>
                <li>✅ Supabase Auth（密碼登入 / 登入連結）</li>
                <li>✅ profiles 資料表與 RLS policy</li>
                <li>✅ GitHub Actions：lint、typecheck、test、build、E2E</li>
                <li>⏳ Phase 2：來源匯入、Storage 直傳、processing_jobs</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
