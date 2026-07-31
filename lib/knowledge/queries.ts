import { createClient } from "@/lib/supabase/server";
import type {
  EntityRow,
  FactStatus,
  FactVersionRow,
  KnowledgeFactRow,
  RelationRow,
  RiskLevel,
} from "@/lib/supabase/types";

export interface KnowledgeFilters {
  status?: FactStatus;
  riskLevel?: RiskLevel;
  sourceId?: string;
  search?: string;
  limit?: number;
}

export async function listKnowledgeFacts(
  filters: KnowledgeFilters = {},
): Promise<KnowledgeFactRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("knowledge_facts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  // 預設只列現行事實，被取代的版本不會混進來。
  query = query.eq("status", filters.status ?? "active");
  if (filters.riskLevel) query = query.eq("risk_level", filters.riskLevel);
  if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
  if (filters.search) query = query.ilike("statement", `%${filters.search}%`);

  const { data, error } = await query;
  if (error) throw new Error(`讀取正式事實失敗：${error.message}`);
  return data ?? [];
}

export async function getKnowledgeFact(
  id: string,
): Promise<KnowledgeFactRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_facts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`讀取正式事實失敗：${error.message}`);
  return data;
}

/** 同一條事實的所有版本（沿著 supersedes 鏈往回找）。 */
export async function listFactHistory(
  fact: KnowledgeFactRow,
): Promise<KnowledgeFactRow[]> {
  const supabase = await createClient();
  const history: KnowledgeFactRow[] = [fact];

  let cursor = fact.supersedes;
  while (cursor && history.length < 20) {
    const { data } = await supabase
      .from("knowledge_facts")
      .select("*")
      .eq("id", cursor)
      .maybeSingle();

    if (!data) break;
    history.push(data);
    cursor = data.supersedes;
  }

  return history;
}

export async function listFactVersions(
  knowledgeFactId: string,
): Promise<FactVersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fact_versions")
    .select("*")
    .eq("knowledge_fact_id", knowledgeFactId)
    .order("version", { ascending: false });

  if (error) throw new Error(`讀取事實版本失敗：${error.message}`);
  return data ?? [];
}

export interface EmbeddingStatus {
  active: number;
  inactive: number;
  model: string | null;
}

export async function getEmbeddingStatus(
  knowledgeFactId?: string,
): Promise<EmbeddingStatus> {
  const supabase = await createClient();

  const base = (isActive: boolean) => {
    const query = supabase
      .from("embedding_records")
      .select("id", { count: "exact", head: true })
      .eq("is_active", isActive);
    return knowledgeFactId ? query.eq("knowledge_fact_id", knowledgeFactId) : query;
  };

  const [active, inactive, latest] = await Promise.all([
    base(true),
    base(false),
    supabase
      .from("embedding_records")
      .select("embedding_model")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    active: active.count ?? 0,
    inactive: inactive.count ?? 0,
    model: latest.data?.embedding_model ?? null,
  };
}

export interface KnowledgeStats {
  active: number;
  inactive: number;
  superseded: number;
  highRisk: number;
  entities: number;
  relations: number;
  approvedPendingPromotion: number;
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  const supabase = await createClient();

  const countFacts = (status: FactStatus) =>
    supabase
      .from("knowledge_facts")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

  const [active, inactive, superseded, highRisk, entities, relations, approved] =
    await Promise.all([
      countFacts("active"),
      countFacts("inactive"),
      countFacts("superseded"),
      supabase
        .from("knowledge_facts")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .eq("risk_level", "high"),
      supabase.from("entities").select("id", { count: "exact", head: true }),
      supabase.from("relations").select("id", { count: "exact", head: true }),
      supabase
        .from("candidate_facts")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved"),
    ]);

  return {
    active: active.count ?? 0,
    inactive: inactive.count ?? 0,
    superseded: superseded.count ?? 0,
    highRisk: highRisk.count ?? 0,
    entities: entities.count ?? 0,
    relations: relations.count ?? 0,
    approvedPendingPromotion: approved.count ?? 0,
  };
}

export async function listEntities(limit = 200): Promise<EntityRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entities")
    .select("*")
    .order("fact_count", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取實體失敗：${error.message}`);
  return data ?? [];
}

export interface RelationWithNames extends RelationRow {
  subject_name: string;
  object_name: string | null;
  statement: string | null;
}

export async function listRelations(limit = 200): Promise<RelationWithNames[]> {
  const supabase = await createClient();

  const [{ data: relations, error }, { data: entities }, { data: facts }] =
    await Promise.all([
      supabase
        .from("relations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase.from("entities").select("id, name"),
      supabase.from("knowledge_facts").select("id, statement"),
    ]);

  if (error) throw new Error(`讀取關聯失敗：${error.message}`);

  const entityName = new Map((entities ?? []).map((item) => [item.id, item.name]));
  const factStatement = new Map(
    (facts ?? []).map((item) => [item.id, item.statement]),
  );

  return (relations ?? []).map((relation) => ({
    ...relation,
    subject_name: entityName.get(relation.subject_entity_id) ?? "（未知實體）",
    object_name: relation.object_entity_id
      ? (entityName.get(relation.object_entity_id) ?? "（未知實體）")
      : null,
    statement: relation.knowledge_fact_id
      ? (factStatement.get(relation.knowledge_fact_id) ?? null)
      : null,
  }));
}

/** 尚未寫入正式事實庫的已核定候選事實。 */
export async function listApprovedPendingPromotion(limit = 500) {
  const supabase = await createClient();

  const [{ data: approved }, { data: promoted }] = await Promise.all([
    supabase
      .from("candidate_facts")
      .select("id, statement, source_id")
      .eq("status", "approved")
      .limit(limit),
    supabase
      .from("knowledge_facts")
      .select("candidate_fact_id")
      .not("candidate_fact_id", "is", null),
  ]);

  const done = new Set((promoted ?? []).map((row) => row.candidate_fact_id));
  return (approved ?? []).filter((row) => !done.has(row.id));
}
