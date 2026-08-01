import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { VerificationPanel } from "@/components/verify/verification-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getAnswerSession,
  listAnswerEvidence,
  listAnswerSentences,
} from "@/lib/answering/queries";
import { formatDateTime } from "@/lib/jobs/labels";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "逐句驗證詳情" };
export const dynamic = "force-dynamic";

export default async function VerifyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=/verify/${id}`);

  const session = await getAnswerSession(id);
  if (!session) notFound();

  const [sentences, evidence] = await Promise.all([
    listAnswerSentences(id),
    listAnswerEvidence(id),
  ]);

  return (
    <AppShell
      title="逐句驗證"
      description={session.question}
      actions={
        <Link
          href="/verify"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← 回驗證清單
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>回答與判定</CardTitle>
            <CardDescription>
              {session.verified_at
                ? `驗證於 ${formatDateTime(session.verified_at)}．綠 ${session.supported_count}、黃 ${session.partial_count}、紅 ${session.unsupported_count}`
                : "尚未驗證"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VerificationPanel
              sessionId={session.id}
              sentences={sentences}
              publishable={session.publishable}
              publishedAnswer={session.published_answer}
              verifiedAt={session.verified_at}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>證據包</CardTitle>
            <CardDescription>判定時比對的核定事實。</CardDescription>
          </CardHeader>
          <CardContent>
            {evidence.length === 0 ? (
              <p className="text-sm text-slate-500">沒有證據可比對。</p>
            ) : (
              <ul className="space-y-3">
                {evidence.map((item) => (
                  <li key={item.id} className="rounded border border-slate-200 p-3">
                    <Badge className="bg-slate-900 font-mono text-white">
                      {item.knowledge_ref}
                    </Badge>
                    <Link
                      href={`/knowledge/${item.knowledge_fact_id}`}
                      className="mt-1 block text-sm text-slate-800 hover:underline"
                    >
                      {item.statement}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.source_title ?? "未知來源"}．
                      {item.source_locator ?? "—"}
                    </p>
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
