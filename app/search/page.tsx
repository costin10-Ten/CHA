import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
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
import { listEntities } from "@/lib/knowledge/queries";
import { searchKnowledgeFacts } from "@/lib/retrieval/search";
import { listSourceOptions } from "@/lib/facts/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import type { KnowledgeType, RiskLevel } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "搜尋" };
export const dynamic = "force-dynamic";

const TYPES: KnowledgeType[] = [
  "substance",
  "concept",
  "policy",
  "event",
  "topic",
  "other",
];
const RISKS: RiskLevel[] = ["low", "medium", "high"];

type SearchParams = {
  q?: string;
  source?: string;
  type?: string;
  risk?: string;
  entity?: string;
  mode?: string;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/search");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const useVector = params.mode !== "keyword";

  let searchError: string | null = null;

  const [results, sources, entities] = await Promise.all([
    searchKnowledgeFacts({
      query,
      sourceId: params.source || undefined,
      knowledgeType: (TYPES as string[]).includes(params.type ?? "")
        ? (params.type as KnowledgeType)
        : undefined,
      riskLevel: (RISKS as string[]).includes(params.risk ?? "")
        ? (params.risk as RiskLevel)
        : undefined,
      entityId: params.entity || undefined,
      useVector,
      limit: 30,
    }).catch((cause: unknown) => {
      searchError = cause instanceof Error ? cause.message : "搜尋失敗";
      return [];
    }),
    listSourceOptions().catch(() => []),
    listEntities(100).catch(() => []),
  ]);

  return (
    <AppShell
      title="搜尋"
      description="關鍵字、PostgreSQL 全文、三元組相似度與向量四路並用，只搜尋現行的核定事實。"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>查詢條件</CardTitle>
            <CardDescription>
              可依文件、知識類型、風險等級與實體篩選；也可切換成純關鍵字比對。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="space-y-3">
              <input
                name="q"
                defaultValue={query}
                placeholder="例如：甲基汞 孕婦 攝取"
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              />

              <div className="grid gap-3 sm:grid-cols-5">
                <Select name="source" label="文件" value={params.source}>
                  <option value="">全部</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.title}
                    </option>
                  ))}
                </Select>

                <Select name="type" label="知識類型" value={params.type}>
                  <option value="">全部</option>
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {KNOWLEDGE_TYPE_LABEL[value]}
                    </option>
                  ))}
                </Select>

                <Select name="risk" label="風險等級" value={params.risk}>
                  <option value="">全部</option>
                  {RISKS.map((value) => (
                    <option key={value} value={value}>
                      {RISK_LEVEL_LABEL[value]}
                    </option>
                  ))}
                </Select>

                <Select name="entity" label="實體" value={params.entity}>
                  <option value="">全部</option>
                  {entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </Select>

                <Select name="mode" label="比對方式" value={params.mode}>
                  <option value="hybrid">混合（含向量）</option>
                  <option value="keyword">只用關鍵字</option>
                </Select>
              </div>

              <div>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  搜尋
                </button>
                <Link
                  href="/search"
                  className="ml-3 text-sm text-slate-600 hover:text-slate-900"
                >
                  清除
                </Link>
                {query && (
                  <Link
                    href={`/ask?q=${encodeURIComponent(query)}`}
                    className="ml-3 text-sm text-blue-700 underline"
                  >
                    以這個問題提問
                  </Link>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {searchError && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">搜尋功能無法使用</p>
            <p className="mt-1">{searchError}</p>
            <p className="mt-2 text-xs">
              最常見的原因是資料庫尚未套用 Phase 6 的 migration （
              <code>search_knowledge_facts</code> 函式）。 請確認 GitHub Actions 的
              Supabase Migrations 已成功執行。
            </p>
          </div>
        )}

        <p className="text-sm text-slate-600">
          找到 {results.length} 筆現行核定事實
          {useVector ? "（混合搜尋）" : "（純關鍵字）"}
        </p>

        {results.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-slate-500">
                沒有符合的事實。可能是還沒有核定任何事實，或關鍵字太特殊。
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {results.map((row) => (
              <li key={row.id}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={RISK_LEVEL_CLASS[row.risk_level]}>
                        {RISK_LEVEL_LABEL[row.risk_level]}
                      </Badge>
                      <Badge className="bg-slate-100 text-slate-700">
                        {KNOWLEDGE_TYPE_LABEL[row.knowledge_type]}
                      </Badge>
                      <span className="text-xs text-slate-500">v{row.version}</span>
                      <span className="ml-auto flex gap-3 text-xs text-slate-500">
                        <span>關鍵字 {row.keyword_rank.toFixed(2)}</span>
                        <span>向量 {row.vector_similarity.toFixed(2)}</span>
                        <span className="font-medium text-slate-700">
                          總分 {row.combined_score.toFixed(2)}
                        </span>
                      </span>
                    </div>

                    <Link
                      href={`/knowledge/${row.id}`}
                      className="block text-sm font-medium text-slate-900 hover:underline"
                    >
                      {row.statement}
                    </Link>

                    <blockquote className="border-l-2 border-slate-300 pl-3 text-xs text-slate-600">
                      {row.source_quote}
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
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
