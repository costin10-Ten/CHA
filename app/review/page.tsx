import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ReviewList } from "@/components/review/review-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CANDIDATE_STATUS_LABEL,
  KNOWLEDGE_TYPE_LABEL,
  RISK_LEVEL_LABEL,
  qualityFlagLabel,
} from "@/lib/facts/labels";
import {
  getCandidateStats,
  listCandidateFacts,
  listSourceOptions,
} from "@/lib/facts/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import type {
  CandidateStatus,
  KnowledgeType,
  RiskLevel,
} from "@/lib/supabase/types";

export const metadata: Metadata = { title: "候選事實審核" };
export const dynamic = "force-dynamic";

const STATUS_VALUES: CandidateStatus[] = [
  "pending",
  "approved",
  "rejected",
  "needs_fix",
];
const RISK_VALUES: RiskLevel[] = ["low", "medium", "high"];
const TYPE_VALUES: KnowledgeType[] = [
  "substance",
  "concept",
  "policy",
  "event",
  "topic",
  "other",
];
const FLAG_VALUES = [
  "number_mismatch",
  "incomplete_subject",
  "multi_proposition",
  "condition_lost",
  "certainty_escalated",
  "inference_suspected",
  "duplicate",
  "contradiction",
];

type SearchParams = {
  source?: string;
  status?: string;
  risk?: string;
  type?: string;
  flag?: string;
};

function pick<T extends string>(
  value: string | undefined,
  allowed: T[],
): T | undefined {
  return value && (allowed as string[]).includes(value) ? (value as T) : undefined;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/review");

  const params = await searchParams;
  const filters = {
    sourceId: params.source || undefined,
    status: pick(params.status, STATUS_VALUES),
    riskLevel: pick(params.risk, RISK_VALUES),
    knowledgeType: pick(params.type, TYPE_VALUES),
    flag: pick(params.flag, FLAG_VALUES),
  };

  const [facts, stats, sources] = await Promise.all([
    listCandidateFacts(filters),
    getCandidateStats(filters.sourceId),
    listSourceOptions(),
  ]);

  return (
    <AppShell
      title="候選事實"
      description="AI 拆出的候選事實與自動品質檢查結果。核定、修正與駁回等操作在 Phase 4 加入。"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="候選總數" value={stats.total} />
          <StatTile label="待審核" value={stats.pending} />
          <StatTile label="已核定" value={stats.approved} />
          <StatTile label="高風險" value={stats.highRisk} />
          <StatTile label="有品質標記" value={stats.flagged} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>篩選</CardTitle>
            <CardDescription>
              可依來源文件、審核狀態、風險等級、知識類型與品質標記篩選。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="grid gap-3 sm:grid-cols-5">
              <Select name="source" label="來源文件" value={params.source}>
                <option value="">全部</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                  </option>
                ))}
              </Select>

              <Select name="status" label="狀態" value={params.status}>
                <option value="">全部</option>
                {STATUS_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {CANDIDATE_STATUS_LABEL[value]}
                  </option>
                ))}
              </Select>

              <Select name="risk" label="風險等級" value={params.risk}>
                <option value="">全部</option>
                {RISK_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {RISK_LEVEL_LABEL[value]}
                  </option>
                ))}
              </Select>

              <Select name="type" label="知識類型" value={params.type}>
                <option value="">全部</option>
                {TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {KNOWLEDGE_TYPE_LABEL[value]}
                  </option>
                ))}
              </Select>

              <Select name="flag" label="品質標記" value={params.flag}>
                <option value="">全部</option>
                {FLAG_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {qualityFlagLabel(value)}
                  </option>
                ))}
              </Select>

              <div className="sm:col-span-5">
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  套用篩選
                </button>
                <Link
                  href="/review"
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
                沒有符合條件的候選事實。先到
                <Link href="/sources" className="mx-1 underline">
                  來源
                </Link>
                匯入文件，解析完成後系統會自動排入抽取工作。
              </p>
            </CardContent>
          </Card>
        ) : (
          <ReviewList facts={facts} />
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

function Select({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
      >
        {children}
      </select>
    </label>
  );
}
