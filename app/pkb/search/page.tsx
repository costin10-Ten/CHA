import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PkbEmbedButton } from "@/components/pkb/embed-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { countPkbPendingEmbeddings, searchPkb } from "@/lib/pkb/search";
import { getCurrentUser } from "@/lib/supabase/server";
import { PKB_SOURCE_TYPES, type PkbSourceType } from "@/lib/supabase/types";
import { PKB_SOURCE_TYPE_LABEL } from "@shared/pkb-pack.ts";

export const metadata: Metadata = { title: "搜尋原子知識" };
export const dynamic = "force-dynamic";

export default async function PkbSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; tag?: string; mode?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/pkb/search");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const sourceType = (PKB_SOURCE_TYPES as string[]).includes(params.type ?? "")
    ? (params.type as PkbSourceType)
    : undefined;

  let error: string | null = null;
  const [results, pendingEmbeddings] = await Promise.all([
    query || sourceType || params.tag
      ? searchPkb({
          query,
          sourceType,
          tag: params.tag || undefined,
          useVector: params.mode !== "keyword",
        }).catch((cause: unknown) => {
          error = cause instanceof Error ? cause.message : "搜尋失敗";
          return [];
        })
      : Promise.resolve([]),
    countPkbPendingEmbeddings().catch(() => 0),
  ]);

  return (
    <AppShell
      title="搜尋原子知識"
      description="關鍵字與語意的混合檢索，只查已同意的知識。垃圾桶與待同意的不會出現。"
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <form className="grid gap-3 sm:grid-cols-4">
              <label className="min-w-0 space-y-1 sm:col-span-2">
                <span className="block text-xs font-medium text-slate-600">
                  查詢
                </span>
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="輸入關鍵字或一句話"
                  className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900"
                />
              </label>

              <label className="block min-w-0 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  來源分類
                </span>
                <select
                  name="type"
                  defaultValue={params.type ?? ""}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                >
                  <option value="">全部</option>
                  {PKB_SOURCE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {PKB_SOURCE_TYPE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="h-10 rounded-md bg-slate-900 px-4 text-sm text-white"
                >
                  搜尋
                </button>
              </div>
            </form>

            <PkbEmbedButton pending={pendingEmbeddings} />
            <p className="text-xs text-slate-500">
              沒有向量的知識仍然搜得到，只是只靠關鍵字比對。 補齊之後才有語意搜尋。
            </p>
          </CardContent>
        </Card>

        {error && (
          <Card>
            <CardContent className="pt-6">
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            </CardContent>
          </Card>
        )}

        {results.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-slate-500">
                {query || sourceType || params.tag
                  ? "沒有符合的原子知識。"
                  : "輸入關鍵字開始搜尋。"}
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
                      <Badge className="bg-slate-100 text-slate-700">
                        {PKB_SOURCE_TYPE_LABEL[row.source_type]}
                      </Badge>
                      {row.is_self_authored && (
                        <Badge className="bg-amber-100 text-amber-800">
                          自製內容
                        </Badge>
                      )}
                      {row.tags.map((tag) => (
                        <Badge key={tag} className="bg-sky-50 text-sky-700">
                          {tag}
                        </Badge>
                      ))}
                      <span className="ml-auto flex gap-3 text-xs text-slate-500">
                        <span>關鍵字 {row.keyword_rank.toFixed(2)}</span>
                        <span>語意 {row.vector_similarity.toFixed(2)}</span>
                      </span>
                    </div>
                    <p className="text-sm text-slate-900">{row.statement}</p>
                    <p className="text-xs text-slate-500">
                      來源：{row.source_label}
                      {row.source_url && (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={row.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            原始連結
                          </a>
                        </>
                      )}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-slate-500">
          要把整個知識庫交給其他 LLM 問答，請到
          <Link href="/pkb/export" className="mx-1 underline">
            匯出
          </Link>
          。
        </p>
      </div>
    </AppShell>
  );
}
