import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { JobMonitor } from "@/components/sources/job-monitor";
import { SourceActions } from "@/components/sources/source-actions";
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
import { getCandidateStats } from "@/lib/facts/queries";
import {
  getSource,
  listChunks,
  listJobs,
  listVersions,
} from "@/lib/sources/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "來源詳情" };
export const dynamic = "force-dynamic";

const CHUNK_PREVIEW_LIMIT = 60;

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=/sources/${id}`);

  const source = await getSource(id);
  if (!source) notFound();

  const [versions, jobs, candidateStats] = await Promise.all([
    listVersions(id),
    listJobs(id),
    getCandidateStats(id),
  ]);
  const currentVersion = versions.find((version) => version.is_current) ?? null;
  const chunks = currentVersion
    ? await listChunks(currentVersion.id, CHUNK_PREVIEW_LIMIT)
    : [];

  return (
    <AppShell
      title={source.title}
      description={`${SOURCE_TYPE_LABEL[source.source_type]}．建立於 ${formatDateTime(source.created_at)}`}
      actions={<SourceActions sourceId={source.id} />}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>現行版本段落</CardTitle>
              <CardDescription>
                {currentVersion
                  ? `v${currentVersion.version}．${currentVersion.chunk_count} 個段落．${currentVersion.char_count} 字．解析器 ${currentVersion.parser_version}`
                  : "尚未解析完成。"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chunks.length === 0 ? (
                <p className="text-sm text-slate-500">
                  還沒有段落。等背景工作完成後這裡會顯示帶編號的段落，
                  之後每一筆原子命題都會指向其中一個編號。
                </p>
              ) : (
                <ol className="space-y-3">
                  {chunks.map((chunk) => (
                    <li
                      key={chunk.id}
                      className="rounded-md border border-slate-200 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-medium text-slate-700">
                          {chunk.paragraph_id}
                        </span>
                        <span>{chunk.block_type}</span>
                        {chunk.heading_path.length > 0 && (
                          <span className="truncate">
                            {chunk.heading_path.join(" › ")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm whitespace-pre-wrap text-slate-800">
                        {chunk.text}
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              {currentVersion &&
                currentVersion.chunk_count > CHUNK_PREVIEW_LIMIT && (
                  <p className="mt-4 text-xs text-slate-500">
                    僅顯示前 {CHUNK_PREVIEW_LIMIT} 個段落，共{" "}
                    {currentVersion.chunk_count} 個。
                  </p>
                )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>文件資訊</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <Row label="狀態">
                  <Badge className={SOURCE_STATUS_CLASS[source.status]}>
                    {SOURCE_STATUS_LABEL[source.status]}
                  </Badge>
                </Row>
                <Row label="現行版本">v{source.current_version}</Row>
                <Row label="大小">{formatBytes(source.byte_size)}</Row>
                <Row label="取得時間">{formatDateTime(source.fetched_at)}</Row>
                <Row label="內容雜湊">
                  <span className="font-mono text-xs">
                    {source.content_hash ? source.content_hash.slice(0, 12) : "—"}
                  </span>
                </Row>
                {source.origin_url && (
                  <Row label="來源網址">
                    <Link
                      href={source.origin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-blue-700 underline"
                    >
                      開啟原文
                    </Link>
                  </Row>
                )}
                {source.storage_path && (
                  <Row label="Storage">
                    <span className="truncate font-mono text-xs">
                      {source.storage_path}
                    </span>
                  </Row>
                )}
              </dl>

              {source.last_error && (
                <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {source.last_error}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>候選原子命題</CardTitle>
              <CardDescription>解析完成後系統會自動排入抽取工作。</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <Row label="候選總數">{candidateStats.total}</Row>
                <Row label="待審核">{candidateStats.pending}</Row>
                <Row label="高風險">{candidateStats.highRisk}</Row>
                <Row label="有品質標記">{candidateStats.flagged}</Row>
              </dl>
              <Link
                href={`/review?source=${source.id}`}
                className="mt-3 inline-block text-sm text-blue-700 underline"
              >
                前往審核這份文件的候選原子命題
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>背景工作</CardTitle>
              <CardDescription>處理中會自動更新。</CardDescription>
            </CardHeader>
            <CardContent>
              <JobMonitor sourceId={source.id} initialJobs={jobs} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>版本歷史</CardTitle>
              <CardDescription>舊版本保留不覆蓋。</CardDescription>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-sm text-slate-500">尚無版本。</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {versions.map((version) => (
                    <li
                      key={version.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-800">
                        v{version.version}
                        {version.is_current && (
                          <Badge className="ml-2 bg-emerald-100 text-emerald-800">
                            現行
                          </Badge>
                        )}
                      </span>
                      <span className="text-xs text-slate-500">
                        {version.chunk_count} 段 ·{" "}
                        {formatDateTime(version.created_at)}
                      </span>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-slate-800">{children}</dd>
    </div>
  );
}
