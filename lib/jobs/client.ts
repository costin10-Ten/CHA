"use client";

import { createClient } from "@/lib/supabase/client";

/** 目前部署的背景 worker。順序即處理順序：先解析文件，再抽取候選事實。 */
export const WORKER_FUNCTIONS = ["process-document", "extract-facts"] as const;

/**
 * 觸發 Edge Function 立即處理待辦工作。
 *
 * 失敗不影響正確性：工作已經寫進 processing_jobs，
 * Supabase Cron 仍會在下一輪認領（見 README 的排程設定）。
 */
export async function kickWorker(): Promise<{ ok: boolean; message?: string }> {
  const supabase = createClient();
  const messages: string[] = [];

  for (const name of WORKER_FUNCTIONS) {
    try {
      const { error } = await supabase.functions.invoke(name, { body: {} });
      if (error) messages.push(`${name}: ${error.message}`);
    } catch (cause) {
      messages.push(
        `${name}: ${cause instanceof Error ? cause.message : "無法觸發背景工作"}`,
      );
    }
  }

  return messages.length === 0
    ? { ok: true }
    : { ok: false, message: messages.join("；") };
}
