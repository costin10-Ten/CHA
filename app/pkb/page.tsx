import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PkbItemList } from "@/components/pkb/item-list";
import { Card, CardContent } from "@/components/ui/card";
import { getPkbStats, listPkbItems } from "@/lib/pkb/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { PKB_SOURCE_TYPES, type PkbSourceType } from "@/lib/supabase/types";
import { PKB_SOURCE_TYPE_LABEL } from "@shared/pkb-pack.ts";

export const metadata: Metadata = { title: "個人原子知識庫" };
export const dynamic = "force-dynamic";

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function PkbPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/pkb");

  const params = await searchParams;
  const status =
    params.status === "draft" || params.status === "active"
      ? params.status
      : undefined;
  const sourceType = (PKB_SOURCE_TYPES as string[]).includes(params.type ?? "")
    ? (params.type as PkbSourceType)
    : undefined;

  const [items, stats] = await Promise.all([
    listPkbItems({ status, sourceType, query: params.q }),
    getPkbStats(),
  ]);

  return (
    <AppShell
      title="個人原子知識庫"
      description="在其他 LLM 整理好的原子知識，匯入後人工同意即可使用。這一版不比對原文，只要求標註來源。"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="待同意" value={stats.draft} />
          <StatTile label="已同意" value={stats.active} />
          <StatTile label="自製內容" value={stats.selfAuthored} />
          <StatTile label="垃圾桶" value={stats.trashed} />
        </div>

        <Card>
          <CardContent className="pt-6">
            <form className="grid gap-3 sm:grid-cols-4">
              <label className="min-w-0 space-y-1">
                <span className="block text-sm font-medium text-slate-800">
                  關鍵字
                </span>
                <input
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder="敘述包含…"
                  className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900"
                />
              </label>

              <Select name="status" label="狀態" value={params.status}>
                <option value="">待同意與已同意</option>
                <option value="draft">只看待同意</option>
                <option value="active">只看已同意</option>
              </Select>

              <Select name="type" label="來源分類" value={params.type}>
                <option value="">全部</option>
                {PKB_SOURCE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {PKB_SOURCE_TYPE_LABEL[value]}
                  </option>
                ))}
              </Select>

              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className="h-10 rounded-md bg-slate-900 px-4 text-sm text-white"
                >
                  篩選
                </button>
                <Link
                  href="/pkb"
                  className="h-10 rounded-md border border-slate-300 px-4 text-sm leading-10 text-slate-700"
                >
                  清除
                </Link>
              </div>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              垃圾桶的內容不會出現在這個清單。要查看或還原請到
              <Link href="/pkb/trash" className="mx-1 underline">
                垃圾桶
              </Link>
              。
            </p>
          </CardContent>
        </Card>

        <PkbItemList items={items} />
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
