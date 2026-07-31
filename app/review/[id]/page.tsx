import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FactEditor } from "@/components/review/fact-editor";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CANDIDATE_STATUS_CLASS,
  CANDIDATE_STATUS_LABEL,
  RISK_LEVEL_CLASS,
  RISK_LEVEL_LABEL,
  qualityFlagLabel,
} from "@/lib/facts/labels";
import {
  findSimilarCandidates,
  getCandidateFact,
  getParagraphContext,
  listReviewRecords,
} from "@/lib/facts/queries";
import { REVIEW_ACTION_LABEL, type ReviewAction } from "@/lib/facts/review";
import { formatDateTime } from "@/lib/jobs/labels";
import { getSource } from "@/lib/sources/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "單筆審核" };
export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=/review/${id}`);

  const fact = await getCandidateFact(id);
  if (!fact) notFound();

  const [source, context, records, similar] = await Promise.all([
    getSource(fact.source_id),
    getParagraphContext(fact.source_version_id, fact.source_paragraph_id),
    listReviewRecords(fact.id),
    findSimilarCandidates(user.id, fact.statement, fact.id),
  ]);

  return (
    <AppShell
      title="單筆審核"
      description={`${source?.title ?? "未知來源"}．段落 ${fact.source_paragraph_id}`}
      actions={
        <Link
          href="/review"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← 回候選事實清單
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={CANDIDATE_STATUS_CLASS[fact.status]}>
                  {CANDIDATE_STATUS_LABEL[fact.status]}
                </Badge>
                <Badge className={RISK_LEVEL_CLASS[fact.risk_level]}>
                  {RISK_LEVEL_LABEL[fact.risk_level]}
                </Badge>
                <span className="text-xs text-slate-500">
                  品質分數 {fact.quality_score}
                </span>
                {fact.edited && (
                  <Badge className="bg-purple-100 text-purple-800">已修正</Badge>
                )}
              </div>
              {fact.quality_flags.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {fact.quality_flags.map((flag) => (
                    <Badge key={flag} className="bg-amber-100 text-amber-900">
                      {qualityFlagLabel(flag)}
                    </Badge>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <FactEditor fact={fact} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>原文片段</CardTitle>
              <CardDescription>事實必須完全由這段文字支持。</CardDescription>
            </CardHeader>
            <CardContent>
              <blockquote className="border-l-2 border-emerald-400 pl-3 text-sm text-slate-800">
                {fact.source_quote}
              </blockquote>
              {fact.original_statement && (
                <div className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">
                  修正前：{fact.original_statement}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>前後文</CardTitle>
              <CardDescription>用來判斷事實是否超出原文範圍。</CardDescription>
            </CardHeader>
            <CardContent>
              {context.length === 0 ? (
                <p className="text-sm text-slate-500">找不到對應段落。</p>
              ) : (
                <ol className="space-y-2">
                  {context.map((chunk) => (
                    <li
                      key={chunk.paragraph_id}
                      className={`rounded p-2 text-sm ${
                        chunk.paragraph_id === fact.source_paragraph_id
                          ? "bg-emerald-50 text-slate-900"
                          : "text-slate-600"
                      }`}
                    >
                      <span className="mr-2 font-mono text-xs text-slate-500">
                        {chunk.paragraph_id}
                      </span>
                      {chunk.text}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>來源文件</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">標題</dt>
                  <dd className="text-right text-slate-800">
                    {source?.title ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">版本</dt>
                  <dd className="text-slate-800">
                    v{source?.current_version ?? "—"}
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
              </dl>
              <Link
                href={`/sources/${fact.source_id}`}
                className="mt-3 inline-block text-sm text-blue-700 underline"
              >
                檢視這份文件
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>相似的既有事實</CardTitle>
              <CardDescription>避免重複核定同一件事。</CardDescription>
            </CardHeader>
            <CardContent>
              {similar.length === 0 ? (
                <p className="text-sm text-slate-500">沒有明顯相似的事實。</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {similar.map((item) => (
                    <li
                      key={item.id}
                      className="rounded border border-slate-200 p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge className={CANDIDATE_STATUS_CLASS[item.status]}>
                          {CANDIDATE_STATUS_LABEL[item.status]}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          相似度 {(item.similarity * 100).toFixed(0)}%
                        </span>
                      </div>
                      <Link
                        href={`/review/${item.id}`}
                        className="mt-1 block text-slate-800 hover:underline"
                      >
                        {item.statement}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>審核歷程</CardTitle>
              <CardDescription>每一次操作都會留下紀錄。</CardDescription>
            </CardHeader>
            <CardContent>
              {records.length === 0 ? (
                <p className="text-sm text-slate-500">尚無審核紀錄。</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {records.map((record) => (
                    <li
                      key={record.id}
                      className="border-l-2 border-slate-200 pl-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">
                          {REVIEW_ACTION_LABEL[record.action as ReviewAction] ??
                            record.action}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatDateTime(record.created_at)}
                        </span>
                      </div>
                      {record.from_status && record.to_status && (
                        <p className="text-xs text-slate-500">
                          {CANDIDATE_STATUS_LABEL[record.from_status]} →{" "}
                          {CANDIDATE_STATUS_LABEL[record.to_status]}
                        </p>
                      )}
                      {record.note && (
                        <p className="mt-0.5 text-xs text-slate-600">
                          {record.note}
                        </p>
                      )}
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
