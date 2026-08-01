import "server-only";

import { createEmbeddingProvider } from "@shared/llm/embeddings.ts";

import { createClient } from "@/lib/supabase/server";
import type {
  KnowledgeType,
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
  knowledgeType?: KnowledgeType;
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
    p_knowledge_type: filters.knowledgeType ?? null,
    p_risk_level: filters.riskLevel ?? null,
    p_entity_id: filters.entityId ?? null,
    p_limit: filters.limit ?? 20,
  });

  if (error) throw new Error(`搜尋失敗：${error.message}`);
  return data ?? [];
}
