"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  JOB_STATUS_CLASS,
  JOB_STATUS_LABEL,
  formatDateTime,
  isTerminalJobStatus,
} from "@/lib/jobs/labels";
import { createClient } from "@/lib/supabase/client";
import type { ProcessingJobRow } from "@/lib/supabase/types";

const POLL_INTERVAL_MS = 2500;

/**
 * 背景工作進度。
 * 只要還有未結束的工作就持續輪詢；全部結束後重新整理頁面，
 * 讓伺服器端重新讀取版本與段落。
 */
export function JobMonitor({
  sourceId,
  initialJobs,
}: {
  sourceId: string;
  initialJobs: ProcessingJobRow[];
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);

  const hasActive = jobs.some((job) => !isTerminalJobStatus(job.status));

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!data) return;
    setJobs(data);

    if (data.every((job) => isTerminalJobStatus(job.status))) {
      router.refresh();
    }
  }, [sourceId, router]);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActive, refresh]);

  if (jobs.length === 0) {
    return <p className="text-sm text-slate-500">尚無背景工作紀錄。</p>;
  }

  return (
    <ul className="space-y-3">
      {jobs.map((job) => (
        <li key={job.id} className="rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge className={JOB_STATUS_CLASS[job.status]}>
                {JOB_STATUS_LABEL[job.status]}
              </Badge>
              <span className="text-sm text-slate-700">{job.job_type}</span>
            </div>
            <span className="text-xs text-slate-500">
              第 {job.attempts} / {job.max_attempts} 次嘗試 ·{" "}
              {formatDateTime(job.created_at)}
            </span>
          </div>

          {!isTerminalJobStatus(job.status) && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.max(job.progress, 5)}%` }}
              />
            </div>
          )}

          {job.last_error && (
            <p className="mt-2 text-xs text-red-600">錯誤：{job.last_error}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
