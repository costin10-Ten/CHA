import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PKB_USAGE_NOTICE } from "@/lib/pkb/export";
import { getPkbStats } from "@/lib/pkb/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "匯出給其他 LLM" };
export const dynamic = "force-dynamic";

export default async function PkbExportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/pkb/export");

  const stats = await getPkbStats();

  return (
    <AppShell
      title="匯出給其他 LLM"
      description="把已同意的原子知識匯出成一份檔案，貼進任何 LLM 就能拿它來問答。"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>下載</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-700">
              目前有 <strong>{stats.active}</strong> 筆已同意的原子知識
              {stats.selfAuthored > 0 && (
                <>（其中 {stats.selfAuthored} 筆是自製內容）</>
              )}
              。待同意與垃圾桶的內容不會匯出。
            </p>

            <div className="flex flex-wrap gap-2">
              <a
                href="/api/pkb/export?format=markdown"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
              >
                下載 Markdown（貼進對話用）
              </a>
              <a
                href="/api/pkb/export?format=jsonl"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                下載 JSONL（給程式處理）
              </a>
            </div>

            {stats.active === 0 && (
              <p className="text-xs text-amber-700">
                還沒有已同意的知識。到
                <Link href="/pkb" className="mx-1 underline">
                  知識庫
                </Link>
                同意幾筆之後再回來。
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>檔案開頭會附這段使用說明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-4 text-xs whitespace-pre-wrap text-slate-800">
              {PKB_USAGE_NOTICE}
            </pre>
            <p className="text-xs text-slate-500">
              這段是寫給模型看的。最重要的一條是第 3 點：
              模擬題與正式發想點是你自己寫的，不是外部依據——
              沒有這條，你的發想會被當成查到的事實引用回來。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>兩種格式怎麼選</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p>
              <strong>Markdown</strong>：依來源分類分組，自製內容逐筆標【自製】。
              直接貼進對話即可，適合日常使用。
            </p>
            <p>
              <strong>JSONL</strong>：一行一筆，第一行是說明。
              適合寫程式處理，或之後串接檢索。
            </p>
            <p className="text-xs text-slate-500">
              知識量大到貼不進對話時，改用
              <Link href="/pkb/search" className="mx-1 underline">
                搜尋
              </Link>
              找出相關的幾筆再貼。
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
