import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { KNOWLEDGE_TYPE_LABEL } from "@/lib/facts/labels";
import { listEntities } from "@/lib/knowledge/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "實體" };
export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/entities");

  const entities = await listEntities();

  return (
    <AppShell
      title="實體"
      description="從正式事實的主體與客體整理出的實體。核定事實時自動建立與累計。"
    >
      {entities.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-500">
              還沒有實體。核定候選事實後，其主體與客體會自動整理到這裡。
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entities.map((entity) => (
            <li key={entity.id}>
              <Card>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {entity.name}
                    </span>
                    <Badge className="bg-slate-100 text-slate-700">
                      {KNOWLEDGE_TYPE_LABEL[entity.entity_type]}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    出現於 {entity.fact_count} 筆事實
                  </p>
                  {entity.description && (
                    <p className="text-sm text-slate-700">{entity.description}</p>
                  )}
                  <Link
                    href={`/knowledge?q=${encodeURIComponent(entity.name)}`}
                    className="inline-block text-xs text-blue-700 underline"
                  >
                    查看相關事實
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
