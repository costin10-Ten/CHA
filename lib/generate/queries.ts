import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CommunicationDraftRow, DraftType } from "@/lib/supabase/types";

export async function listDrafts(
  filters: { draftType?: DraftType; limit?: number } = {},
): Promise<CommunicationDraftRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("communication_drafts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 50);

  if (filters.draftType) query = query.eq("draft_type", filters.draftType);

  const { data, error } = await query;
  if (error) throw new Error(`讀取素材草稿失敗：${error.message}`);
  return data ?? [];
}

export async function getDraft(id: string): Promise<CommunicationDraftRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`讀取素材草稿失敗：${error.message}`);
  return data;
}

export interface DraftFact {
  id: string;
  knowledge_ref: string;
  statement: string;
  source_id: string;
  source_paragraph_id: string;
  source_quote: string;
}

/** 草稿使用的核定事實，依知識編號排序，供介面對照。 */
export async function listDraftFacts(
  draft: CommunicationDraftRow,
): Promise<DraftFact[]> {
  if (draft.knowledge_fact_ids.length === 0) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_facts")
    .select("id, statement, source_id, source_paragraph_id, source_quote")
    .in("id", draft.knowledge_fact_ids);

  const byId = new Map((data ?? []).map((row) => [row.id, row]));

  return draft.knowledge_fact_ids
    .map((factId, index) => {
      const fact = byId.get(factId);
      if (!fact) return null;
      return {
        id: fact.id,
        knowledge_ref: draft.knowledge_refs[index] ?? `K-${index + 1}`,
        statement: fact.statement,
        source_id: fact.source_id,
        source_paragraph_id: fact.source_paragraph_id,
        source_quote: fact.source_quote,
      };
    })
    .filter((fact): fact is DraftFact => fact !== null);
}

export interface DraftStats {
  total: number;
  blocked: number;
  final: number;
  publishable: number;
}

export async function getDraftStats(): Promise<DraftStats> {
  const supabase = await createClient();

  const base = () =>
    supabase
      .from("communication_drafts")
      .select("id", { count: "exact", head: true });

  const [total, blocked, final, publishable] = await Promise.all([
    base(),
    base().eq("status", "blocked"),
    base().eq("status", "final"),
    base().eq("publishable", true),
  ]);

  return {
    total: total.count ?? 0,
    blocked: blocked.count ?? 0,
    final: final.count ?? 0,
    publishable: publishable.count ?? 0,
  };
}
