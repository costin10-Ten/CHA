import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { listRelations } from "@/lib/knowledge/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "關聯" };
export const dynamic = "force-dynamic";

export default async function RelationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/relations");

  const relations = await listRelations();

  return (
    <AppShell
      title="關聯"
      description="實體之間的關係。每一筆都指向支持它的正式事實，沒有事實支持的關聯不會存在。"
    >
      {relations.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-500">
              還沒有關聯。候選事實若填有主體、關係與客體，核定後就會建立對應關聯。
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {relations.map((relation) => (
            <li key={relation.id}>
              <Card>
                <CardContent className="space-y-1 pt-6">
                  <p className="text-sm text-slate-900">
                    <span className="font-medium">{relation.subject_name}</span>
                    <span className="mx-2 text-slate-500">
                      —{relation.predicate}→
                    </span>
                    <span className="font-medium">
                      {relation.object_name ?? "（未指定客體）"}
                    </span>
                  </p>
                  {relation.statement && relation.knowledge_fact_id && (
                    <Link
                      href={`/knowledge/${relation.knowledge_fact_id}`}
                      className="block text-xs text-slate-600 underline hover:text-slate-900"
                    >
                      依據：{relation.statement}
                    </Link>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
