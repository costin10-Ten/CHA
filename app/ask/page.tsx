import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { AskForm } from "@/components/ask/ask-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAnswerEvidence, listAnswerSessions } from "@/lib/answering/queries";
import { formatDateTime } from "@/lib/jobs/labels";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "AI 問答" };
export const dynamic = "force-dynamic";

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/ask");

  const params = await searchParams;

  let loadError: string | null = null;
  const sessions = await listAnswerSessions(10).catch((cause: unknown) => {
    loadError = cause instanceof Error ? cause.message : "讀取問答紀錄失敗";
    return [];
  });

  const latest = sessions[0];
  const evidence = latest
    ? await listAnswerEvidence(latest.id).catch(() => [])
    : [];

  return (
    <AppShell
      title="AI 問答"
      description="回答只能使用核定事實。每一段都標註知識編號，可回溯到原文段落。"
    >
      <div className="space-y-6">
        {loadError && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">問答功能無法使用</p>
            <p className="mt-1">{loadError}</p>
            <p className="mt-2 text-xs">
              最常見的原因是資料庫尚未套用 Phase 6 的 migration （
              <code>answer_sessions</code> 等資料表）。 請確認 GitHub Actions 的
              Supabase Migrations 已成功執行。
            </p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>提問</CardTitle>
            <CardDescription>
              系統會先用混合搜尋取出相關的核定事實組成證據包，再交給模型作答。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AskForm defaultQuestion={params.q ?? ""} />
          </CardContent>
        </Card>

        {latest && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader>
                <CardTitle>{latest.question}</CardTitle>
                <CardDescription>
                  {formatDateTime(latest.created_at)}．{latest.provider ?? "—"}／
                  {latest.model ?? "—"}． 使用 {latest.evidence_count} 筆核定事實
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {latest.insufficient_evidence && (
                  <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                    這個回答已標示為「證據不足」——系統不會用模型自身知識補足。
                  </p>
                )}

                {latest.error && (
                  <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                    {latest.error}
                  </p>
                )}

                <div className="space-y-3 text-sm whitespace-pre-wrap text-slate-800">
                  {latest.answer ?? "（尚無回答）"}
                </div>

                {latest.verified_at && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    {latest.publishable ? (
                      <Badge className="bg-emerald-100 text-emerald-800">
                        可發布
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-800">
                        有紅色句子，發布稿已阻擋
                      </Badge>
                    )}
                    <span className="text-xs text-emerald-700">
                      綠 {latest.supported_count}
                    </span>
                    <span className="text-xs text-amber-700">
                      黃 {latest.partial_count}
                    </span>
                    <span className="text-xs text-red-700">
                      紅 {latest.unsupported_count}
                    </span>
                    <Link
                      href={`/verify/${latest.id}`}
                      className="ml-auto text-sm text-blue-700 underline"
                    >
                      檢視逐句驗證
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>證據包</CardTitle>
                <CardDescription>送進模型的全部內容。</CardDescription>
              </CardHeader>
              <CardContent>
                {evidence.length === 0 ? (
                  <p className="text-sm text-slate-500">沒有找到相關的核定事實。</p>
                ) : (
                  <ul className="space-y-3">
                    {evidence.map((item) => (
                      <li
                        key={item.id}
                        className="rounded border border-slate-200 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge className="bg-slate-900 font-mono text-white">
                            {item.knowledge_ref}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            分數 {item.combined_score.toFixed(2)}
                          </span>
                        </div>
                        <Link
                          href={`/knowledge/${item.knowledge_fact_id}`}
                          className="mt-1 block text-sm text-slate-800 hover:underline"
                        >
                          {item.statement}
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.source_title ?? "未知來源"}．
                          {item.source_locator ?? "—"}．v{item.fact_version}
                        </p>
                        {item.source_url && (
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-700 underline"
                          >
                            開啟原文
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {sessions.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>最近的問答</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {sessions.slice(1).map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0"
                  >
                    <span className="truncate text-slate-800">
                      {session.question}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                      {session.insufficient_evidence && (
                        <Badge className="bg-amber-100 text-amber-900">
                          資料不足
                        </Badge>
                      )}
                      <span>{session.evidence_count} 筆證據</span>
                      <span>{formatDateTime(session.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
