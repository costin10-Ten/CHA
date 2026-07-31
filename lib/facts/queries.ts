import { createClient } from "@/lib/supabase/server";
import type {
  CandidateFactRow,
  CandidateStatus,
  KnowledgeType,
  RiskLevel,
  SourceRow,
} from "@/lib/supabase/types";

export interface CandidateFilters {
  sourceId?: string;
  status?: CandidateStatus;
  riskLevel?: RiskLevel;
  knowledgeType?: KnowledgeType;
  /** 只列出帶有特定品質標記的候選事實。 */
  flag?: string;
  limit?: number;
}

export async function listCandidateFacts(
  filters: CandidateFilters = {},
): Promise<CandidateFactRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("candidate_facts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.riskLevel) query = query.eq("risk_level", filters.riskLevel);
  if (filters.knowledgeType)
    query = query.eq("knowledge_type", filters.knowledgeType);
  if (filters.flag) query = query.contains("quality_flags", [filters.flag]);

  const { data, error } = await query;
  if (error) throw new Error(`讀取候選事實失敗：${error.message}`);
  return data ?? [];
}

export interface CandidateStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  highRisk: number;
  flagged: number;
}

export async function getCandidateStats(
  sourceId?: string,
): Promise<CandidateStats> {
  const supabase = await createClient();

  const base = () => {
    const query = supabase
      .from("candidate_facts")
      .select("id", { count: "exact", head: true });
    return sourceId ? query.eq("source_id", sourceId) : query;
  };

  const [total, pending, approved, rejected, highRisk, flagged] = await Promise.all(
    [
      base(),
      base().eq("status", "pending"),
      base().eq("status", "approved"),
      base().eq("status", "rejected"),
      base().eq("risk_level", "high"),
      base().not("quality_flags", "eq", "{}"),
    ],
  );

  return {
    total: total.count ?? 0,
    pending: pending.count ?? 0,
    approved: approved.count ?? 0,
    rejected: rejected.count ?? 0,
    highRisk: highRisk.count ?? 0,
    flagged: flagged.count ?? 0,
  };
}

/** 審核介面的來源下拉選單。 */
export async function listSourceOptions(): Promise<
  Pick<SourceRow, "id" | "title">[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sources")
    .select("id, title")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`讀取來源清單失敗：${error.message}`);
  return data ?? [];
}

/** 依段落編號取回原文，供審核時對照。 */
export async function getParagraphTexts(
  sourceVersionId: string,
  paragraphIds: string[],
): Promise<Map<string, string>> {
  if (paragraphIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_chunks")
    .select("paragraph_id, text")
    .eq("source_version_id", sourceVersionId)
    .in("paragraph_id", paragraphIds);

  if (error) throw new Error(`讀取原文失敗：${error.message}`);
  return new Map((data ?? []).map((chunk) => [chunk.paragraph_id, chunk.text]));
}
