import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { SettingsNav } from "@/components/settings/settings-nav";
import { FeedbackResolveButton } from "@/components/settings/feedback-resolve-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FEEDBACK_TYPE_SHORT } from "@/lib/facts/feedback-labels";
import { formatDateTime } from "@/lib/jobs/labels";
import {
  getPromptFeedbackStats,
  listExtractionFeedback,
  listPromptVersions,
} from "@/lib/settings/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "提示詞與抽取回報" };
export const dynamic = "force-dynamic";

export default async function PromptSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/settings/prompts");

  let loadError: string | null = null;
  const [versions, stats, feedback] = await Promise.all([
    listPromptVersions().catch((cause: unknown) => {
      loadError = cause instanceof Error ? cause.message : "讀取提示詞失敗";
      return [];
    }),
    getPromptFeedbackStats(),
    listExtractionFeedback().catch(() => []),
  ]);

  const statById = new Map(stats.map((stat) => [stat.prompt_version_id, stat]));

  return (
    <AppShell
      title="提示詞與抽取回報"
      description="每一版提示詞被回報了多少問題、集中在哪一類。用來判斷提示詞該怎麼調整。"
    >
      <SettingsNav current="/settings/prompts" />

      <div className="space-y-6">
        {loadError && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">無法讀取提示詞版本</p>
            <p className="mt-1">{loadError}</p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>提示詞版本</CardTitle>
            <CardDescription>
              提示詞內容變更時會自動建立新版本（以 checksum
              判斷），舊版本保留供追溯。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {versions.length === 0 ? (
              <p className="text-sm text-slate-500">
                還沒有提示詞版本。第一次執行抽取或問答後就會出現。
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="py-2 pr-3">名稱</th>
                      <th className="py-2 pr-3">版本</th>
                      <th className="py-2 pr-3">用途</th>
                      <th className="py-2 pr-3">回報數</th>
                      <th className="py-2 pr-3">未處理</th>
                      <th className="py-2 pr-3">最常見問題</th>
                      <th className="py-2">建立時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((version) => {
                      const stat = statById.get(version.id);
                      const count = Number(stat?.feedback_count ?? 0);
                      const unresolved = Number(stat?.unresolved_count ?? 0);

                      return (
                        <tr
                          key={version.id}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="py-2 pr-3 font-medium text-slate-900">
                            {version.name}
                          </td>
                          <td className="py-2 pr-3">v{version.version}</td>
                          <td className="py-2 pr-3 text-slate-600">
                            {version.purpose}
                          </td>
                          <td className="py-2 pr-3">
                            {count > 0 ? (
                              <Badge
                                className={
                                  count >= 5
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-900"
                                }
                              >
                                {count}
                              </Badge>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">{unresolved}</td>
                          <td className="py-2 pr-3 text-slate-600">
                            {stat?.top_issue
                              ? FEEDBACK_TYPE_SHORT[stat.top_issue]
                              : "—"}
                          </td>
                          <td className="py-2 text-xs text-slate-400">
                            {formatDateTime(version.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>抽取問題回報</CardTitle>
            <CardDescription>
              審核時按「回報抽取問題」留下的紀錄。處理完（例如已調整提示詞）可標記為已處理。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {feedback.length === 0 ? (
              <p className="text-sm text-slate-500">
                目前沒有回報。到候選原子命題審核時，按「回報抽取問題」即可記錄。
              </p>
            ) : (
              <ul className="space-y-3">
                {feedback.map((item) => (
                  <li
                    key={item.id}
                    className={`rounded-md border p-3 ${
                      item.resolved
                        ? "border-slate-200 bg-slate-50"
                        : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-900 text-white">
                        {FEEDBACK_TYPE_SHORT[item.feedback_type]}
                      </Badge>
                      {item.resolved && (
                        <Badge className="bg-emerald-100 text-emerald-800">
                          已處理
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-slate-400">
                        {formatDateTime(item.created_at)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-slate-900">
                      {item.statement_snapshot ?? "（沒有敘述快照）"}
                    </p>

                    {item.description && (
                      <p className="mt-1 text-sm text-slate-700">
                        說明：{item.description}
                      </p>
                    )}

                    {item.quote_snapshot && (
                      <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs text-slate-600">
                        原文片段：{item.quote_snapshot}
                      </blockquote>
                    )}

                    <div className="mt-2">
                      <FeedbackResolveButton
                        feedbackId={item.id}
                        resolved={item.resolved}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
