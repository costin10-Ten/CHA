import { createClient } from "@/lib/supabase/server";
import type {
  DocumentChunkRow,
  ProcessingJobRow,
  SourceRow,
  SourceVersionRow,
} from "@/lib/supabase/types";

/** 所有查詢都經過 RLS，只會取到目前使用者自己的資料。 */

export async function listSources(): Promise<SourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sources")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`讀取來源清單失敗：${error.message}`);
  return data ?? [];
}

export async function getSource(sourceId: string): Promise<SourceRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (error) throw new Error(`讀取來源失敗：${error.message}`);
  return data;
}

export async function listVersions(sourceId: string): Promise<SourceVersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("source_versions")
    .select("*")
    .eq("source_id", sourceId)
    .order("version", { ascending: false });

  if (error) throw new Error(`讀取版本失敗：${error.message}`);
  return data ?? [];
}

export async function listChunks(
  sourceVersionId: string,
  limit = 100,
): Promise<DocumentChunkRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_chunks")
    .select("*")
    .eq("source_version_id", sourceVersionId)
    .order("position", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`讀取段落失敗：${error.message}`);
  return data ?? [];
}

export async function listJobs(
  sourceId: string,
  limit = 10,
): Promise<ProcessingJobRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("processing_jobs")
    .select("*")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取工作紀錄失敗：${error.message}`);
  return data ?? [];
}

export interface SourceStats {
  total: number;
  ready: number;
  pending: number;
  failed: number;
  chunkCount: number;
}

export async function getSourceStats(): Promise<SourceStats> {
  const supabase = await createClient();

  const [all, ready, pending, failed, chunks] = await Promise.all([
    supabase.from("sources").select("id", { count: "exact", head: true }),
    supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("status", "ready"),
    supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "processing"]),
    supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase.from("document_chunks").select("id", { count: "exact", head: true }),
  ]);

  return {
    total: all.count ?? 0,
    ready: ready.count ?? 0,
    pending: pending.count ?? 0,
    failed: failed.count ?? 0,
    chunkCount: chunks.count ?? 0,
  };
}
