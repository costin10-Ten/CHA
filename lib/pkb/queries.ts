import { createClient } from "@/lib/supabase/server";
import type {
  PkbEntityRow,
  PkbItemRow,
  PkbReviewLogRow,
  PkbSourceType,
  PkbStatus,
} from "@/lib/supabase/types";

/**
 * 個人原子知識庫的讀取層。
 *
 * 所有清單查詢預設排除垃圾桶——需求是「丟進垃圾桶就不顯示出來」，
 * 所以排除要寫在這裡，而不是靠每個呼叫端記得加條件。
 */

export interface PkbFilters {
  status?: PkbStatus;
  sourceType?: PkbSourceType;
  tag?: string;
  query?: string;
  limit?: number;
}

export async function listPkbItems(
  filters: PkbFilters = {},
): Promise<PkbItemRow[]> {
  const supabase = await createClient();

  let request = supabase
    .from("pkb_items")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  // 沒有指定狀態時一律排除垃圾桶。要看垃圾桶請明確傳 status: "trashed"。
  if (filters.status) request = request.eq("status", filters.status);
  else request = request.neq("status", "trashed");

  if (filters.sourceType) request = request.eq("source_type", filters.sourceType);
  if (filters.tag) request = request.contains("tags", [filters.tag]);
  if (filters.query?.trim()) {
    request = request.ilike("statement", `%${filters.query.trim()}%`);
  }

  const { data, error } = await request;
  if (error) throw new Error(`讀取原子知識失敗：${error.message}`);
  return data ?? [];
}

export interface PkbStats {
  draft: number;
  active: number;
  trashed: number;
  selfAuthored: number;
  bySourceType: Record<string, number>;
}

export async function getPkbStats(): Promise<PkbStats> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("pkb_items")
    .select("status, source_type, is_self_authored");

  if (error) throw new Error(`讀取統計失敗：${error.message}`);

  const stats: PkbStats = {
    draft: 0,
    active: 0,
    trashed: 0,
    selfAuthored: 0,
    bySourceType: {},
  };

  for (const row of data ?? []) {
    stats[row.status] += 1;
    if (row.status === "trashed") continue;
    if (row.is_self_authored) stats.selfAuthored += 1;
    stats.bySourceType[row.source_type] =
      (stats.bySourceType[row.source_type] ?? 0) + 1;
  }

  return stats;
}

export async function getPkbItem(id: string): Promise<PkbItemRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pkb_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

export async function listPkbReviewLog(itemId: string): Promise<PkbReviewLogRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pkb_review_log")
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function listPkbEntities(limit = 100): Promise<PkbEntityRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pkb_entities")
    .select("*")
    .order("item_count", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** 已同意的知識，供匯出給其他 LLM 使用。 */
export async function listActivePkbItems(): Promise<PkbItemRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pkb_items")
    .select("*")
    .eq("status", "active")
    .order("source_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`讀取原子知識失敗：${error.message}`);
  return data ?? [];
}
