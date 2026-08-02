import "server-only";

import { createEmbeddingProvider } from "@shared/llm/embeddings.ts";

import { createClient } from "@/lib/supabase/server";
import type {
  PropositionType,
  RiskLevel,
  SearchResultRow,
} from "@/lib/supabase/types";

/**
 * 混合搜尋：關鍵字（ILIKE）＋ PostgreSQL 全文搜尋 ＋ 三元組相似度 ＋ 向量相似度，
 * 並可依文件、知識類型、風險等級與實體篩選。
 * owner_id 與 active 狀態的限制在資料庫函式中強制執行。
 */

export interface SearchFilters {
  query?: string;
  sourceId?: string;
  propositionType?: PropositionType;
  riskLevel?: RiskLevel;
  entityId?: string;
  limit?: number;
  /** 關閉向量比對時只做關鍵字搜尋。 */
  useVector?: boolean;
}

/** 伺服器端的 embedding 設定：預設 mock，不需要金鑰。 */
function embeddingConfig() {
  const provider =
    process.env.EMBEDDING_PROVIDER ?? process.env.LLM_PROVIDER ?? "mock";
  return {
    provider,
    model: process.env.EMBEDDING_MODEL || undefined,
    apiKey: process.env.OPENAI_API_KEY || undefined,
    baseUrl: process.env.LLM_BASE_URL || undefined,
  };
}

export async function embedQuery(query: string): Promise<number[] | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const provider = createEmbeddingProvider(embeddingConfig());
    const [vector] = await provider.embed([trimmed]);
    return vector ?? null;
  } catch {
    // 向量失敗時退回純關鍵字搜尋，不讓搜尋整個壞掉。
    return null;
  }
}

export async function searchKnowledgeFacts(
  filters: SearchFilters,
): Promise<SearchResultRow[]> {
  const supabase = await createClient();
  const query = filters.query?.trim() ?? "";

  const embedding = filters.useVector === false ? null : await embedQuery(query);

  const { data, error } = await supabase.rpc("search_knowledge_facts", {
    p_query: query,
    p_embedding: embedding ? JSON.stringify(embedding) : null,
    p_source_id: filters.sourceId ?? null,
    p_proposition_type: filters.propositionType ?? null,
    p_risk_level: filters.riskLevel ?? null,
    p_entity_id: filters.entityId ?? null,
    p_limit: filters.limit ?? 20,
  });

  if (!error) return data ?? [];

  // RPC 不存在或失敗時（例如 migration 尚未套用）退回純資料表查詢，
  // 讓搜尋降級成關鍵字比對而不是整頁失效。
  const fallback = await keywordOnlySearch(filters);
  if (fallback) return fallback;

  throw new Error(`搜尋失敗：${error.message}`);
}

/** 不依賴任何自訂函式的關鍵字搜尋，作為降級方案。 */
async function keywordOnlySearch(
  filters: SearchFilters,
): Promise<SearchResultRow[] | null> {
  const supabase = await createClient();
  const query = filters.query?.trim() ?? "";

  let request = supabase
    .from("knowledge_facts")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 20);

  if (query) request = request.ilike("statement", `%${query}%`);
  if (filters.sourceId) request = request.eq("source_id", filters.sourceId);
  if (filters.propositionType) {
    // 分類是陣列，篩選是「包含這一類」。
    request = request.contains("proposition_types", [filters.propositionType]);
  }
  if (filters.riskLevel) request = request.eq("risk_level", filters.riskLevel);

  const { data, error } = await request;
  if (error) return null;

  return (data ?? []).map((fact) => ({
    id: fact.id,
    statement: fact.statement,
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
    conditions: fact.conditions,
    proposition_types: fact.proposition_types,
    risk_level: fact.risk_level,
    version: fact.version,
    source_id: fact.source_id,
    source_paragraph_id: fact.source_paragraph_id,
    source_quote: fact.source_quote,
    keyword_rank: query ? 1 : 0,
    vector_similarity: 0,
    combined_score: query ? 1 : 0,
  }));
}
