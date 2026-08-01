import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CORRECTION_GOALS } from "@shared/pack.ts";

import { AppShell } from "@/components/app-shell";
import { PackImport } from "@/components/export/pack-import";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listSourceOptions } from "@/lib/facts/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "匯出與備份" };
export const dynamic = "force-dynamic";

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/export");

  const params = await searchParams;
  const sources = await listSourceOptions().catch(() => []);
  const sourceQuery = params.source ? `&source=${params.source}` : "";

  return (
    <AppShell
      title="匯出與備份"
      description="匯出正式事實、事實與來源對照表、單篇文件，以及要丟給其他 LLM 校正的待選事實包。"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>正式事實</CardTitle>
            <CardDescription>
              只包含現行版本（status = active）。每筆都附原文片段與段落編號。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DownloadRow
              label="全部正式事實"
              hrefs={{
                JSON: `/api/export?kind=facts&format=json${sourceQuery}`,
                CSV: `/api/export?kind=facts&format=csv${sourceQuery}`,
                Markdown: `/api/export?kind=facts&format=markdown${sourceQuery}`,
              }}
            />
            <DownloadRow
              label="事實與來源對照表"
              hrefs={{
                JSON: `/api/export?kind=mapping&format=json${sourceQuery}`,
                CSV: `/api/export?kind=mapping&format=csv${sourceQuery}`,
                Markdown: `/api/export?kind=mapping&format=markdown${sourceQuery}`,
              }}
            />

            <form method="get" className="flex flex-wrap items-end gap-3 pt-2">
              {/* 文件標題可能很長；min-w-0 + w-full 讓下拉留在卡片內。 */}
              <label className="block w-full min-w-0 text-sm sm:w-64">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  只匯出某一份文件
                </span>
                <select
                  name="source"
                  defaultValue={params.source ?? ""}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                >
                  <option value="">全部文件</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                套用
              </button>
              {params.source && (
                <Link href="/export" className="text-sm text-slate-600 underline">
                  清除
                </Link>
              )}
            </form>
          </CardContent>
        </Card>

        {params.source && (
          <Card>
            <CardHeader>
              <CardTitle>單篇文件與其事實</CardTitle>
              <CardDescription>
                包含這份文件現行版本的全部段落，以及由它產生的正式事實。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DownloadRow
                label="文件 + 事實"
                hrefs={{
                  JSON: `/api/export?kind=document&format=json&source=${params.source}`,
                  Markdown: `/api/export?kind=document&format=markdown&source=${params.source}`,
                  CSV: `/api/export?kind=document&format=csv&source=${params.source}`,
                }}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>待選事實包（給其他 LLM 校正）</CardTitle>
            <CardDescription>
              匯出待審核的候選事實。包內自帶欄位說明與校正目標，接手的模型不需要本專案脈絡也能正確處理。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DownloadRow
              label="待審核候選事實包"
              hrefs={{
                JSON: `/api/export?kind=candidates&format=json${sourceQuery}`,
              }}
            />

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-700">
                包內寫明的校正目標
              </p>
              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                {CORRECTION_GOALS.map((goal) => (
                  <li key={goal.目標}>
                    <span className="font-medium text-slate-800">{goal.目標}</span>
                    ：{goal.說明}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-800">回填校正結果</p>
              <p className="mt-1 mb-3 text-xs text-slate-500">
                外部模型處理完後，把 JSON 貼回來或上傳檔案。 系統會比對
                id、擋下被改動的來源欄位、重跑品質檢查。
              </p>
              <PackImport />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>資料庫與檔案備份</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p>
              Supabase 資料庫備份、Storage 檔案備份與還原步驟寫在
              <code className="mx-1 rounded bg-slate-100 px-1">docs/BACKUP.md</code>
              。
            </p>
            <p className="text-xs text-slate-500">
              備份操作需要專案的 service key，只能在本機或 CI
              執行，不會出現在這個頁面上。
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function DownloadRow({
  label,
  hrefs,
}: {
  label: string;
  hrefs: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 p-3">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <span className="ml-auto flex flex-wrap gap-2">
        {Object.entries(hrefs).map(([format, href]) => (
          <a
            key={format}
            href={href}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-100"
          >
            {format}
          </a>
        ))}
      </span>
    </div>
  );
}
