import "server-only";

import type { PackFact } from "@shared/pack.ts";

import { createClient } from "@/lib/supabase/server";
import type {
  DocumentExport,
  ExportBundle,
  ExportFact,
  ExportSource,
} from "@/lib/export/serialize";
import type { CandidateFilters } from "@/lib/facts/queries";

/**
 * 匯出用的查詢。
 * 全部走使用者的 session，RLS 會確保只匯得到自己的資料。
 */

const FACT_COLUMNS =
  "id, statement, subject, predicate, object, proposition_types, risk_level, status, version, conditions, source_id, source_paragraph_id, source_quote, created_at";
const SOURCE_COLUMNS =
  "id, title, source_type, origin_url, content_hash, created_at";

const EXPORT_LIMIT = 5000;

function toExportFacts(rows: unknown[]): ExportFact[] {
  return rows as ExportFact[];
}

export async function loadFactBundle(sourceId?: string): Promise<ExportBundle> {
  const supabase = await createClient();

  let query = supabase
    .from("knowledge_facts")
    .select(FACT_COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(EXPORT_LIMIT);

  if (sourceId) query = query.eq("source_id", sourceId);

  const { data: facts, error } = await query;
  if (error) throw new Error(`讀取正式原子命題失敗：${error.message}`);

  const sourceIds = [...new Set((facts ?? []).map((fact) => fact.source_id))];
  const { data: sources } = sourceIds.length
    ? await supabase.from("sources").select(SOURCE_COLUMNS).in("id", sourceIds)
    : { data: [] as ExportSource[] };

  return {
    facts: toExportFacts(facts ?? []),
    sources: (sources ?? []) as ExportSource[],
    exportedAt: new Date().toISOString(),
  };
}

export async function loadDocumentExport(
  sourceId: string,
): Promise<DocumentExport> {
  const supabase = await createClient();

  const { data: source, error } = await supabase
    .from("sources")
    .select(SOURCE_COLUMNS)
    .eq("id", sourceId)
    .maybeSingle();

  if (error) throw new Error(`讀取來源文件失敗：${error.message}`);
  if (!source) throw new Error("找不到來源文件");

  // 只匯出現行版本的段落，舊版本不混進來。
  const { data: version } = await supabase
    .from("source_versions")
    .select("id")
    .eq("source_id", sourceId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: chunks } = version
    ? await supabase
        .from("document_chunks")
        .select("paragraph_id, text")
        .eq("source_version_id", version.id)
        .order("position", { ascending: true })
    : { data: [] };

  const bundle = await loadFactBundle(sourceId);

  return {
    ...bundle,
    source: source as ExportSource,
    paragraphs: chunks ?? [],
  };
}

/** 待選原子命題包：候選原子命題 + 原文段落全文。 */
export async function loadCandidatePackFacts(
  filters: CandidateFilters = {},
): Promise<PackFact[]> {
  const supabase = await createClient();

  let query = supabase
    .from("candidate_facts")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(filters.limit ?? 500);

  query = query.eq("status", filters.status ?? "pending");
  if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
  if (filters.riskLevel) query = query.eq("risk_level", filters.riskLevel);
  if (filters.propositionType) {
    query = query.contains("proposition_types", [filters.propositionType]);
  }
  if (filters.flag) query = query.contains("quality_flags", [filters.flag]);

  const { data: candidates, error } = await query;
  if (error) throw new Error(`讀取候選原子命題失敗：${error.message}`);
  if (!candidates || candidates.length === 0) return [];

  const sourceIds = [...new Set(candidates.map((fact) => fact.source_id))];
  const versionIds = [...new Set(candidates.map((fact) => fact.source_version_id))];

  const [{ data: sources }, { data: chunks }] = await Promise.all([
    supabase.from("sources").select("id, title, origin_url").in("id", sourceIds),
    supabase
      .from("document_chunks")
      .select("source_version_id, paragraph_id, text")
      .in("source_version_id", versionIds),
  ]);

  const sourceById = new Map((sources ?? []).map((item) => [item.id, item]));
  const paragraphByKey = new Map(
    (chunks ?? []).map((chunk) => [
      `${chunk.source_version_id}:${chunk.paragraph_id}`,
      chunk.text,
    ]),
  );

  return candidates.map((fact) => {
    const source = sourceById.get(fact.source_id);
    return {
      id: fact.id,
      statement: fact.statement,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      proposition_types: fact.proposition_types,
      risk_level: fact.risk_level,
      conditions: (fact.conditions ?? {}) as Record<string, string | null>,
      source_quote: fact.source_quote,
      source_paragraph_id: fact.source_paragraph_id,
      source_title: source?.title ?? null,
      source_url: source?.origin_url ?? null,
      paragraph_text:
        paragraphByKey.get(
          `${fact.source_version_id}:${fact.source_paragraph_id}`,
        ) ?? null,
      quality_flags: fact.quality_flags,
      quality_score: fact.quality_score,
      status: fact.status,
    };
  });
}
