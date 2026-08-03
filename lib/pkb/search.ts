import "server-only";

import { createEmbeddingProvider } from "@shared/llm/embeddings.ts";

import { createClient } from "@/lib/supabase/server";
import type { PkbSearchResultRow, PkbSourceType } from "@/lib/supabase/types";

/**
 * 個人原子知識庫的檢索與向量維護。
 *
 * 向量是增量的：只為還沒有現行向量的知識產生，改一筆只停用那一筆的舊向量。
 * 與 CHA 共用同一組 embedding provider 設定（預設 mock，不需要金鑰）。
 */

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

export interface PkbSearchFilters {
  query?: string;
  sourceType?: PkbSourceType;
  tag?: string;
  limit?: number;
  useVector?: boolean;
}

export async function searchPkb(
  filters: PkbSearchFilters,
): Promise<PkbSearchResultRow[]> {
  const supabase = await createClient();
  const query = filters.query?.trim() ?? "";

  let embedding: number[] | null = null;
  if (filters.useVector !== false && query) {
    try {
      const provider = createEmbeddingProvider(embeddingConfig());
      const [vector] = await provider.embed([query]);
      embedding = vector ?? null;
    } catch {
      // 向量失敗就退回純關鍵字，不讓整個搜尋壞掉。
      embedding = null;
    }
  }

  const { data, error } = await supabase.rpc("pkb_search", {
    p_query: query,
    p_embedding: embedding ? JSON.stringify(embedding) : null,
    p_source_type: filters.sourceType ?? null,
    p_tag: filters.tag ?? null,
    p_limit: filters.limit ?? 30,
  });

  if (error) throw new Error(`搜尋失敗：${error.message}`);
  return data ?? [];
}

export interface EmbedResult {
  embedded: number;
  pending: number;
}

/** 已同意但還沒有現行向量的知識有幾筆。 */
export async function countPkbPendingEmbeddings(): Promise<number> {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("pkb_items")
    .select("id")
    .eq("status", "active");

  const ids = (items ?? []).map((item) => item.id);
  if (ids.length === 0) return 0;

  const { data: embedded } = await supabase
    .from("pkb_embeddings")
    .select("item_id")
    .eq("is_active", true)
    .in("item_id", ids);

  const done = new Set((embedded ?? []).map((row) => row.item_id));
  return ids.filter((id) => !done.has(id)).length;
}
