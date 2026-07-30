import Link from "next/link";
import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "登入｜個人知識庫",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo =
    params.redirectTo && params.redirectTo.startsWith("/")
      ? params.redirectTo
      : "/dashboard";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
            ← 回首頁
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>個人知識庫與風險溝通系統</CardTitle>
            <CardDescription>
              使用 Supabase Auth 登入。所有資料以 Row Level Security
              隔離，只有你本人能讀寫。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p role="alert" className="text-sm text-red-600">
                {params.error}
              </p>
            )}

            {isSupabaseConfigured() ? (
              <LoginForm redirectTo={redirectTo} />
            ) : (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">尚未設定 Supabase 環境變數</p>
                <p>
                  請複製 <code>.env.example</code> 為 <code>.env.local</code>， 填入{" "}
                  <code>NEXT_PUBLIC_SUPABASE_URL</code> 與{" "}
                  <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> 後重新啟動。
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
