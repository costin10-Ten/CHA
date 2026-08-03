import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PkbItemList } from "@/components/pkb/item-list";
import { listPkbItems } from "@/lib/pkb/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "垃圾桶" };
export const dynamic = "force-dynamic";

export default async function PkbTrashPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/pkb/trash");

  const items = await listPkbItems({ status: "trashed" });

  return (
    <AppShell
      title="垃圾桶"
      description="丟掉的原子知識留在這裡，不會出現在清單、搜尋與匯出。還原後回到待同意，需要再看一次才會生效。"
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          共 {items.length} 筆。回到
          <Link href="/pkb" className="mx-1 underline">
            知識庫
          </Link>
          。
        </p>
        <PkbItemList items={items} mode="trash" />
      </div>
    </AppShell>
  );
}
