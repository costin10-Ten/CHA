import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * 處理歷程（工作單第 18 節 /history）。
 *
 * 把散在各表的「做過什麼」合併成一條時間線：
 * 背景工作、審核動作、模型呼叫、抽取問題回報。
 * 任何一種來源查不到都不影響其他來源。
 */

export type HistoryKind = "job" | "review" | "model_run" | "feedback";

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  title: string;
  detail: string | null;
  status: string | null;
  createdAt: string;
  href: string | null;
}

async function safe<T>(work: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

export async function listHistory(
  filters: { kind?: HistoryKind; limit?: number } = {},
): Promise<HistoryEntry[]> {
  const supabase = await createClient();
  const limit = filters.limit ?? 50;
  const wanted = (kind: HistoryKind) => !filters.kind || filters.kind === kind;

  const [jobs, reviews, runs, feedback] = await Promise.all([
    wanted("job")
      ? safe(
          supabase
            .from("processing_jobs")
            .select("id, job_type, status, created_at, last_error, source_id")
            .order("created_at", { ascending: false })
            .limit(limit)
            .then((r) => r.data ?? []),
          [],
        )
      : Promise.resolve([]),
    wanted("review")
      ? safe(
          supabase
            .from("review_records")
            .select(
              "id, action, from_status, to_status, note, created_at, candidate_fact_id",
            )
            .order("created_at", { ascending: false })
            .limit(limit)
            .then((r) => r.data ?? []),
          [],
        )
      : Promise.resolve([]),
    wanted("model_run")
      ? safe(
          supabase
            .from("model_runs")
            .select(
              "id, purpose, provider, model, status, input_tokens, output_tokens, latency_ms, created_at",
            )
            .order("created_at", { ascending: false })
            .limit(limit)
            .then((r) => r.data ?? []),
          [],
        )
      : Promise.resolve([]),
    wanted("feedback")
      ? safe(
          supabase
            .from("extraction_feedback")
            .select(
              "id, feedback_type, description, statement_snapshot, created_at, candidate_fact_id",
            )
            .order("created_at", { ascending: false })
            .limit(limit)
            .then((r) => r.data ?? []),
          [],
        )
      : Promise.resolve([]),
  ]);

  const entries: HistoryEntry[] = [
    ...jobs.map((job) => ({
      id: `job-${job.id}`,
      kind: "job" as const,
      title: job.job_type,
      detail: job.last_error,
      status: job.status,
      createdAt: job.created_at,
      href: job.source_id ? `/sources/${job.source_id}` : null,
    })),
    ...reviews.map((review) => ({
      id: `review-${review.id}`,
      kind: "review" as const,
      title: review.action,
      detail:
        review.note ??
        (review.from_status && review.to_status
          ? `${review.from_status} → ${review.to_status}`
          : null),
      status: review.to_status,
      createdAt: review.created_at,
      href: review.candidate_fact_id ? `/review/${review.candidate_fact_id}` : null,
    })),
    ...runs.map((run) => ({
      id: `run-${run.id}`,
      kind: "model_run" as const,
      title: run.purpose,
      detail: `${run.provider}／${run.model}．${run.input_tokens + run.output_tokens} tokens．${run.latency_ms}ms`,
      status: run.status,
      createdAt: run.created_at,
      href: null,
    })),
    ...feedback.map((item) => ({
      id: `feedback-${item.id}`,
      kind: "feedback" as const,
      title: item.feedback_type,
      detail: item.description ?? item.statement_snapshot,
      status: null,
      createdAt: item.created_at,
      href: item.candidate_fact_id ? `/review/${item.candidate_fact_id}` : null,
    })),
  ];

  return entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
