import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DRAFT_SPECS } from "@shared/generation.ts";

import { AppShell } from "@/components/app-shell";
import {
  DraftEditor,
  type DraftSentence,
} from "@/components/generate/draft-editor";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DRAFT_STATUS_CLASS, DRAFT_STATUS_LABEL } from "@/lib/generate/labels";
import { getDraft, listDraftFacts } from "@/lib/generate/queries";
import { formatDateTime } from "@/lib/jobs/labels";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "素材草稿" };
export const dynamic = "force-dynamic";

/** verification 欄位是 jsonb，讀回來時要確認形狀再交給介面。 */
function toSentences(value: unknown): DraftSentence[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.sentence !== "string") return [];

    const verdict =
      row.verdict === "supported" ||
      row.verdict === "partial" ||
      row.verdict === "unsupported"
        ? row.verdict
        : "unsupported";

    return [
      {
        sentence: row.sentence,
        verdict,
        supportingRefs: Array.isArray(row.supportingRefs)
          ? row.supportingRefs.filter(
              (ref): ref is string => typeof ref === "string",
            )
          : [],
        reasons: Array.isArray(row.reasons)
          ? row.reasons.filter((r): r is string => typeof r === "string")
          : [],
        similarity: typeof row.similarity === "number" ? row.similarity : 0,
        structural: row.structural === true,
      },
    ];
  });
}

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user) redirect(`/login?redirectTo=/generate/${id}`);

  const draft = await getDraft(id);
  if (!draft) notFound();

  const facts = await listDraftFacts(draft);
  const sentences = toSentences(draft.verification);
  const body = draft.edited_body ?? draft.body;

  return (
    <AppShell
      title={draft.title}
      description={`${DRAFT_SPECS[draft.draft_type].label}．受眾 ${draft.audience}．語氣 ${draft.tone}`}
      actions={
        <Link href="/generate" className="text-sm text-blue-700 underline">
          回素材清單
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={DRAFT_STATUS_CLASS[draft.status]}>
            {DRAFT_STATUS_LABEL[draft.status]}
          </Badge>
          <span className="text-xs text-emerald-700">
            綠 {draft.supported_count}
          </span>
          <span className="text-xs text-amber-700">黃 {draft.partial_count}</span>
          <span className="text-xs text-red-700">紅 {draft.unsupported_count}</span>
          <span className="text-xs text-slate-500">
            {draft.provider ?? "—"}／{draft.model ?? "—"}．
            {draft.verified_at
              ? `驗證於 ${formatDateTime(draft.verified_at)}`
              : "尚未驗證"}
          </span>
          <span className="ml-auto text-xs text-slate-400">
            建立於 {formatDateTime(draft.created_at)}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader>
              <CardTitle>內容</CardTitle>
              <CardDescription>
                每一句都標上驗證結果。修改後儲存會重新驗證，不會沿用舊的判定。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DraftEditor
                draftId={draft.id}
                body={body}
                status={draft.status}
                publishable={draft.publishable}
                sentences={sentences}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>使用的核定事實</CardTitle>
              <CardDescription>撰稿時唯一可用的素材。</CardDescription>
            </CardHeader>
            <CardContent>
              {facts.length === 0 ? (
                <p className="text-sm text-slate-500">
                  找不到使用的核定事實（可能已被停用或刪除）。
                </p>
              ) : (
                <ul className="space-y-3">
                  {facts.map((fact) => (
                    <li
                      key={fact.id}
                      className="rounded border border-slate-200 p-3"
                    >
                      <Badge className="bg-slate-900 font-mono text-white">
                        {fact.knowledge_ref}
                      </Badge>
                      <Link
                        href={`/knowledge/${fact.id}`}
                        className="mt-1 block text-sm text-slate-800 hover:underline"
                      >
                        {fact.statement}
                      </Link>
                      <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-xs text-slate-600">
                        {fact.source_quote}
                      </blockquote>
                      <Link
                        href={`/sources/${fact.source_id}`}
                        className="mt-1 inline-block text-xs text-slate-500 underline"
                      >
                        來源．{fact.source_paragraph_id}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {draft.edited_body && (
          <Card>
            <CardHeader>
              <CardTitle>原始產出</CardTitle>
              <CardDescription>
                模型最初的版本，保留下來供比對（工作單第 15 節）。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-slate-700">
                {draft.body}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
