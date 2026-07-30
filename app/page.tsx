import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

const PIPELINE = [
  "貼入文字／上傳檔案／輸入網址",
  "保存原始資料與版本",
  "AI 拆成一句一事的候選事實",
  "單人審核、修正、駁回、拆分或合併",
  "建立正式事實知識庫",
  "標籤、實體、關聯與向量索引",
  "混合搜尋與 AI 問答",
  "回答逐句驗證",
  "產出 FAQ、文章、Podcast、短影音與圖卡文字",
  "增量更新、匯出與備份",
];

export default async function HomePage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await getCurrentUser() : null;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="space-y-4">
          <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            Personal Knowledge Studio
          </p>
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
            個人知識庫與風險溝通產製系統
          </h1>
          <p className="max-w-2xl text-slate-600">
            所有對外內容都必須回溯到「經你核定的事實」與其原始來源片段。AI
            負責拆解與草擬，核定權在你手上。
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            {user ? (
              <Link href="/dashboard">
                <Button>進入 Dashboard</Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button>登入</Button>
              </Link>
            )}
            <a
              href="https://github.com/costin10-Ten/CHA"
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline">GitHub 專案</Button>
            </a>
          </div>
        </header>

        {!configured && (
          <div className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">尚未連接 Supabase</p>
            <p className="mt-1">
              請依 README 建立 Supabase 專案，複製 <code>.env.example</code> 為{" "}
              <code>.env.local</code> 並填入環境變數，再執行{" "}
              <code>npm run db:push</code> 套用 migration。
            </p>
          </div>
        )}

        <section className="mt-12 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>核心流程</CardTitle>
              <CardDescription>
                從匯入到產製的完整鏈路，每一步都保留來源與版本。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm text-slate-700">
                {PIPELINE.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-medium text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>部署架構</CardTitle>
              <CardDescription>
                GitHub → Vercel → Supabase → 模型 API。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-slate-700">
                <li>
                  <span className="font-medium">Vercel</span>：Next.js App
                  Router、Server Actions、Route Handlers
                </li>
                <li>
                  <span className="font-medium">Supabase</span>：Auth、
                  PostgreSQL、pgvector、Storage、RLS、Edge Functions、Queues、Cron
                </li>
                <li>
                  <span className="font-medium">模型層</span>：OpenAI 相容 API、
                  Anthropic API、Mock Provider（測試預設）
                </li>
                <li>
                  <span className="font-medium">品質</span>：ESLint、TypeScript
                  strict、Vitest、Playwright、GitHub Actions
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
