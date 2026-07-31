import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ImportForm } from "@/components/sources/import-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  SOURCE_STATUS_CLASS,
  SOURCE_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  formatBytes,
  formatDateTime,
} from "@/lib/jobs/labels";
import { getSourceStats, listSources } from "@/lib/sources/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "來源" };
export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/sources");

  const [sources, stats] = await Promise.all([listSources(), getSourceStats()]);

  return (
    <AppShell
      title="來源"
      description="貼入文字、上傳檔案或輸入網址。系統會保存原始內容、切成帶編號的段落，並保留每一次解析的版本。"
    >
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>新增來源</CardTitle>
            <CardDescription>
              匯入後會建立背景工作，解析在 Supabase Edge Function 執行。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportForm />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="文件總數" value={stats.total} />
            <StatTile label="已完成" value={stats.ready} />
            <StatTile label="處理中" value={stats.pending} />
            <StatTile label="段落總數" value={stats.chunkCount} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>已匯入文件</CardTitle>
              <CardDescription>點擊文件檢視版本、段落與工作紀錄。</CardDescription>
            </CardHeader>
            <CardContent>
              {sources.length === 0 ? (
                <p className="text-sm text-slate-500">
                  還沒有任何來源。從左側匯入第一篇文件開始。
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {sources.map((source) => (
                    <li key={source.id} className="py-3 first:pt-0 last:pb-0">
                      <Link
                        href={`/sources/${source.id}`}
                        className="group flex flex-wrap items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 group-hover:underline">
                            {source.title}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {SOURCE_TYPE_LABEL[source.source_type]} · v
                            {source.current_version} ·{" "}
                            {formatBytes(source.byte_size)} ·{" "}
                            {formatDateTime(source.created_at)}
                          </p>
                          {source.last_error && (
                            <p className="mt-1 line-clamp-2 text-xs text-red-600">
                              {source.last_error}
                            </p>
                          )}
                        </div>
                        <Badge className={SOURCE_STATUS_CLASS[source.status]}>
                          {SOURCE_STATUS_LABEL[source.status]}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
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
