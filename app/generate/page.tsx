import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DRAFT_SPECS, isDraftType } from "@shared/generation.ts";

import { AppShell } from "@/components/app-shell";
import { GenerateForm } from "@/components/generate/generate-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DRAFT_STATUS_CLASS, DRAFT_STATUS_LABEL } from "@/lib/generate/labels";
import { getDraftStats, listDrafts } from "@/lib/generate/queries";
import { formatDateTime } from "@/lib/jobs/labels";
import { getCurrentUser } from "@/lib/supabase/server";
import type { DraftType } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "風險溝通素材" };
export const dynamic = "force-dynamic";

const TYPE_OPTIONS = Object.entries(DRAFT_SPECS).map(([value, spec]) => ({
  value,
  label: spec.label,
  lengthHint: spec.lengthHint,
}));

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/generate");

  const params = await searchParams;
  const draftType: DraftType | undefined =
    params.type && isDraftType(params.type) ? params.type : undefined;

  let loadError: string | null = null;
  const [drafts, stats] = await Promise.all([
    listDrafts({ draftType }).catch((cause: unknown) => {
      loadError = cause instanceof Error ? cause.message : "讀取素材失敗";
      return [];
    }),
    getDraftStats().catch(() => ({
      total: 0,
      blocked: 0,
      final: 0,
      publishable: 0,
    })),
  ]);

  return (
    <AppShell
      title="風險溝通素材"
      description="用核定原子命題產製 FAQ、短文、腳本與圖卡文字。所有產出預設為草稿，且必須通過逐句驗證才能定稿。"
    >
      <div className="space-y-6">
        {loadError && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">素材功能無法使用</p>
            <p className="mt-1">{loadError}</p>
            <p className="mt-2 text-xs">
              最常見的原因是資料庫尚未套用 Phase 8 的 migration （
              <code>communication_drafts</code>）。 請確認 GitHub Actions 的
              Supabase Migrations 已成功執行。
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="素材總數" value={stats.total} />
          <StatTile label="可發布" value={stats.publishable} />
          <StatTile label="已定稿" value={stats.final} />
          <StatTile label="被阻擋" value={stats.blocked} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>產生新素材</CardTitle>
            <CardDescription>
              系統會先以主題做混合搜尋取出核定原子命題，再依體裁撰稿。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GenerateForm types={TYPE_OPTIONS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>素材清單</CardTitle>
            <CardDescription>
              {draftType
                ? `目前只顯示「${DRAFT_SPECS[draftType].label}」。`
                : "全部素材，最新的在最前面。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Link
                href="/generate"
                className={`rounded-full border px-3 py-1 text-xs ${
                  draftType
                    ? "border-slate-300 text-slate-600"
                    : "border-slate-900 bg-slate-900 text-white"
                }`}
              >
                全部
              </Link>
              {TYPE_OPTIONS.map((type) => (
                <Link
                  key={type.value}
                  href={`/generate?type=${type.value}`}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    draftType === type.value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {type.label}
                </Link>
              ))}
            </div>

            {drafts.length === 0 ? (
              <p className="text-sm text-slate-500">
                還沒有素材。先在上面選一個體裁並輸入主題。
                若提示找不到核定原子命題，請先到
                <Link href="/review" className="mx-1 underline">
                  候選原子命題
                </Link>
                核定幾筆。
              </p>
            ) : (
              <ul className="space-y-3">
                {drafts.map((draft) => (
                  <li
                    key={draft.id}
                    className="rounded-md border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={DRAFT_STATUS_CLASS[draft.status]}>
                        {DRAFT_STATUS_LABEL[draft.status]}
                      </Badge>
                      <Badge className="bg-slate-100 text-slate-700">
                        {DRAFT_SPECS[draft.draft_type].label}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        受眾 {draft.audience}．語氣 {draft.tone}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">
                        {formatDateTime(draft.created_at)}
                      </span>
                    </div>

                    <Link
                      href={`/generate/${draft.id}`}
                      className="mt-2 block text-sm font-medium text-slate-900 hover:underline"
                    >
                      {draft.title}
                    </Link>

                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {(draft.edited_body ?? draft.body).slice(0, 120)}
                    </p>

                    <p className="mt-2 flex flex-wrap gap-3 text-xs">
                      <span className="text-emerald-700">
                        綠 {draft.supported_count}
                      </span>
                      <span className="text-amber-700">
                        黃 {draft.partial_count}
                      </span>
                      <span className="text-red-700">
                        紅 {draft.unsupported_count}
                      </span>
                      <span className="text-slate-500">
                        使用 {draft.knowledge_fact_ids.length} 筆核定原子命題
                      </span>
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
