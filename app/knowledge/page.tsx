import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { KnowledgeToolbar } from "@/components/knowledge/knowledge-actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  KNOWLEDGE_TYPE_LABEL,
  RISK_LEVEL_CLASS,
  RISK_LEVEL_LABEL,
} from "@/lib/facts/labels";
import { formatDateTime } from "@/lib/jobs/labels";
import {
  getEmbeddingStatus,
  getKnowledgeStats,
  listKnowledgeFacts,
} from "@/lib/knowledge/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import type { FactStatus, RiskLevel } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "正式事實" };
export const dynamic = "force-dynamic";

const STATUS_VALUES: FactStatus[] = ["active", "inactive", "superseded"];
const STATUS_LABEL: Record<FactStatus, string> = {
  draft: "草稿",
  active: "現行",
  inactive: "已停用",
  superseded: "已被取代",
};
const STATUS_CLASS: Record<FactStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-800",
  inactive: "bg-slate-200 text-slate-700",
  superseded: "bg-amber-100 text-amber-900",
};

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; risk?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/knowledge");

  const params = await searchParams;
  const status = (STATUS_VALUES as string[]).includes(params.status ?? "")
    ? (params.status as FactStatus)
    : "active";
  const risk = (["low", "medium", "high"] as string[]).includes(params.risk ?? "")
    ? (params.risk as RiskLevel)
    : undefined;

  const [facts, stats, embeddings] = await Promise.all([
    listKnowledgeFacts({ status, riskLevel: risk, search: params.q }),
    getKnowledgeStats(),
    getEmbeddingStatus(),
  ]);

  return (
    <AppShell
      title="正式事實"
      description="經核定的事實。修改會建立新版本，舊版保留並退出搜尋；向量只針對變動的事實重做。"
      actions={<KnowledgeToolbar pendingCount={stats.approvedPendingPromotion} />}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <StatTile label="現行事實" value={stats.active} />
          <StatTile label="已停用" value={stats.inactive} />
          <StatTile label="已被取代" value={stats.superseded} />
          <StatTile label="高風險" value={stats.highRisk} />
          <StatTile label="實體" value={stats.entities} />
          <StatTile label="現行向量" value={embeddings.active} />
        </div>

        {stats.approvedPendingPromotion > 0 && (
          <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            有 {stats.approvedPendingPromotion}{" "}
            筆已核定的候選事實尚未寫入正式事實庫， 可用右上角的按鈕批次寫入。
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>篩選</CardTitle>
            <CardDescription>
              預設只顯示現行事實；被取代的版本仍可查閱但不會進入搜尋。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="grid gap-3 sm:grid-cols-4">
              <label className="block min-w-0 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  狀態
                </span>
                <select
                  name="status"
                  defaultValue={status}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                >
                  {STATUS_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {STATUS_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block min-w-0 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  風險等級
                </span>
                <select
                  name="risk"
                  defaultValue={params.risk ?? ""}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                >
                  <option value="">全部</option>
                  {(["low", "medium", "high"] as RiskLevel[]).map((value) => (
                    <option key={value} value={value}>
                      {RISK_LEVEL_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  關鍵字
                </span>
                <input
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder="在事實敘述中搜尋"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
                />
              </label>

              <div className="sm:col-span-4">
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  套用
                </button>
                <Link
                  href="/knowledge"
                  className="ml-3 text-sm text-slate-600 hover:text-slate-900"
                >
                  清除
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        {facts.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-slate-500">
                還沒有正式事實。到
                <Link href="/review" className="mx-1 underline">
                  候選事實
                </Link>
                核定幾筆，系統會自動寫入這裡並建立向量與關聯。
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {facts.map((fact) => (
              <li key={fact.id}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={STATUS_CLASS[fact.status]}>
                        {STATUS_LABEL[fact.status]}
                      </Badge>
                      <Badge className={RISK_LEVEL_CLASS[fact.risk_level]}>
                        {RISK_LEVEL_LABEL[fact.risk_level]}
                      </Badge>
                      <Badge className="bg-slate-100 text-slate-700">
                        {KNOWLEDGE_TYPE_LABEL[fact.knowledge_type]}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        v{fact.version}
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        {fact.source_paragraph_id}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">
                        {formatDateTime(fact.approved_at)}
                      </span>
                    </div>

                    <Link
                      href={`/knowledge/${fact.id}`}
                      className="block text-sm font-medium text-slate-900 hover:underline"
                    >
                      {fact.statement}
                    </Link>

                    <blockquote className="border-l-2 border-slate-300 pl-3 text-xs text-slate-600">
                      {fact.source_quote}
                    </blockquote>
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
