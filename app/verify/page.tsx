import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listAnswerSessions } from "@/lib/answering/queries";
import { formatDateTime } from "@/lib/jobs/labels";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "逐句驗證" };
export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/verify");

  let loadError: string | null = null;
  const sessions = await listAnswerSessions(50).catch((cause: unknown) => {
    loadError = cause instanceof Error ? cause.message : "讀取問答紀錄失敗";
    return [];
  });

  return (
    <AppShell
      title="逐句驗證"
      description="每一句回答都要對得上核定事實。只要有一句無證據支持，整份回答就不會產生發布稿。"
    >
      <div className="space-y-4">
        {loadError && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">無法讀取問答紀錄</p>
            <p className="mt-1">{loadError}</p>
          </div>
        )}

        {sessions.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-slate-500">
                還沒有問答紀錄。到
                <Link href="/ask" className="mx-1 underline">
                  AI 問答
                </Link>
                提問後，系統會自動拆句並執行驗證。
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {sessions.map((session) => (
              <li key={session.id}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      {session.verified_at ? (
                        session.publishable ? (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            可發布
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800">已阻擋</Badge>
                        )
                      ) : (
                        <Badge className="bg-slate-100 text-slate-700">
                          尚未驗證
                        </Badge>
                      )}
                      <span className="text-xs text-emerald-700">
                        綠 {session.supported_count}
                      </span>
                      <span className="text-xs text-amber-700">
                        黃 {session.partial_count}
                      </span>
                      <span className="text-xs text-red-700">
                        紅 {session.unsupported_count}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">
                        {formatDateTime(session.created_at)}
                      </span>
                    </div>

                    <Link
                      href={`/verify/${session.id}`}
                      className="block text-sm font-medium text-slate-900 hover:underline"
                    >
                      {session.question}
                    </Link>

                    <p className="line-clamp-2 text-xs text-slate-600">
                      {session.answer ?? "（尚無回答）"}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
