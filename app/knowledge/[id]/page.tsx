import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FactRevisionPanel } from "@/components/knowledge/knowledge-actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONDITION_LABEL,
  KNOWLEDGE_TYPE_LABEL,
  RISK_LEVEL_CLASS,
  RISK_LEVEL_LABEL,
} from "@/lib/facts/labels";
import { formatDateTime } from "@/lib/jobs/labels";
import {
  getEmbeddingStatus,
  getKnowledgeFact,
  listFactHistory,
  listFactVersions,
} from "@/lib/knowledge/queries";
import { getSource } from "@/lib/sources/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "正式事實詳情" };
export const dynamic = "force-dynamic";

export default async function KnowledgeFactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=/knowledge/${id}`);

  const fact = await getKnowledgeFact(id);
  if (!fact) notFound();

  const [source, versions, history, embeddings] = await Promise.all([
    getSource(fact.source_id),
    listFactVersions(fact.id),
    listFactHistory(fact),
    getEmbeddingStatus(fact.id),
  ]);

  const conditions = Object.entries(fact.conditions ?? {}).filter(
    ([, value]) => value,
  );

  return (
    <AppShell
      title="正式事實"
      description={`v${fact.version}．${source?.title ?? "未知來源"}．段落 ${fact.source_paragraph_id}`}
      actions={
        <Link
          href="/knowledge"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← 回正式事實
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={RISK_LEVEL_CLASS[fact.risk_level]}>
                  {RISK_LEVEL_LABEL[fact.risk_level]}
                </Badge>
                <Badge className="bg-slate-100 text-slate-700">
                  {KNOWLEDGE_TYPE_LABEL[fact.knowledge_type]}
                </Badge>
                <span className="text-xs text-slate-500">狀態：{fact.status}</span>
              </div>
              <CardDescription>
                {fact.status === "superseded"
                  ? "這是舊版本，已被新版取代，不會出現在搜尋結果中。"
                  : "修改會建立新版本，舊版保留。"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FactRevisionPanel fact={fact} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>版本紀錄</CardTitle>
              <CardDescription>每一版的敘述與修改說明。</CardDescription>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-sm text-slate-500">尚無版本紀錄。</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {versions.map((version) => (
                    <li
                      key={version.id}
                      className="border-l-2 border-slate-200 pl-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">
                          v{version.version}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatDateTime(version.created_at)}
                        </span>
                      </div>
                      <p className="text-slate-700">{version.statement}</p>
                      {version.change_note && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {version.change_note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {history.length > 1 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-xs font-medium text-slate-600">
                    被取代的舊版
                  </p>
                  <ul className="space-y-1 text-xs">
                    {history.slice(1).map((item) => (
                      <li key={item.id}>
                        <Link
                          href={`/knowledge/${item.id}`}
                          className="text-slate-600 underline hover:text-slate-900"
                        >
                          v{item.version}：{item.statement}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>原文片段</CardTitle>
              <CardDescription>正式事實必須能回到這裡。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <blockquote className="border-l-2 border-emerald-400 pl-3 text-sm text-slate-800">
                {fact.source_quote}
              </blockquote>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">文件</dt>
                  <dd className="text-right text-slate-800">
                    <Link
                      href={`/sources/${fact.source_id}`}
                      className="underline hover:text-slate-900"
                    >
                      {source?.title ?? "—"}
                    </Link>
                  </dd>
                </div>
                {source?.origin_url && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">網址</dt>
                    <dd>
                      <a
                        href={source.origin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
                      >
                        開啟原文
                      </a>
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">段落</dt>
                  <dd className="font-mono text-xs text-slate-800">
                    {fact.source_paragraph_id}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {conditions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>條件與限制</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-1 text-sm">
                  {conditions.map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt className="text-slate-500">
                        {CONDITION_LABEL[key] ?? key}
                      </dt>
                      <dd className="text-right text-slate-800">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>向量索引</CardTitle>
              <CardDescription>只有現行向量會被搜尋命中。</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">現行向量</dt>
                  <dd className="text-slate-800">{embeddings.active}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">已停用向量</dt>
                  <dd className="text-slate-800">{embeddings.inactive}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">模型</dt>
                  <dd className="text-right text-xs text-slate-800">
                    {embeddings.model ?? "尚未產生"}
                  </dd>
                </div>
              </dl>
              {embeddings.active === 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  尚未產生向量。到正式事實清單按「補齊缺少的向量」，
                  或等待排程工作執行。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
