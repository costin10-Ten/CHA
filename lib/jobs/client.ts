"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * 觸發 Edge Function 立即處理剛建立的工作。
 *
 * 失敗不影響正確性：工作已經寫進 processing_jobs，
 * Supabase Cron 仍會在下一輪認領（見 README 的排程設定）。
 */
export async function kickWorker(): Promise<{ ok: boolean; message?: string }> {
  try {
    const supabase = createClient();
    const { error } = await supabase.functions.invoke("process-document", {
      body: {},
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "無法觸發背景工作",
    };
  }
}
