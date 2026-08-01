// Supabase Edge Function：排程更新 worker
//
// 觸發方式：
//   1. Supabase Cron 以 x-cron-secret 呼叫 → 檢查所有使用者的網址來源
//   2. 使用者以 JWT 呼叫 → 只檢查自己的來源（介面上的「立即檢查更新」）
//
// 工作流程：
//   enqueue_scheduled_updates（找出過期且沒有排隊中的網址來源）
//   → 建立 parse_document 工作
//   → 由 process-document 重新抓取
//   → 內容雜湊未變則不建立新版本，也不會重抽事實
//   → 內容有變才建立新版本，並且只針對新增與修改的段落重抽候選事實
//
// 這個函式本身不抓網頁、不呼叫模型，只負責「決定哪些來源該重新檢查」。

import { createClient } from "jsr:@supabase/supabase-js@2";

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/** 預設一週檢查一次；呼叫時可用 max_age_hours 覆寫。 */
const DEFAULT_MAX_AGE_HOURS = 168;
const MIN_MAX_AGE_HOURS = 1;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resolveCaller(
  req: Request,
): Promise<
  { mode: "cron" } | { mode: "user"; userId: string } | { mode: "denied" }
> {
  const cronHeader = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronHeader && cronHeader === CRON_SECRET) {
    return { mode: "cron" };
  }

  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return { mode: "denied" };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { mode: "denied" };
  return { mode: "user", userId: data.user.id };
}

function readMaxAgeHours(body: Record<string, unknown>): number {
  const raw = Number(body.max_age_hours);
  if (!Number.isFinite(raw)) return DEFAULT_MAX_AGE_HOURS;
  return Math.max(MIN_MAX_AGE_HOURS, Math.floor(raw));
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "只接受 POST" }, 405);
  }

  const caller = await resolveCaller(req);
  if (caller.mode === "denied") {
    return jsonResponse({ error: "未授權" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // 沒有 body 時使用預設值。
  }

  const maxAgeHours = readMaxAgeHours(body);

  // 使用者呼叫時只處理自己的來源；cron 呼叫時處理全部。
  const { data, error } = await admin.rpc("enqueue_scheduled_updates", {
    p_max_age_hours: maxAgeHours,
    p_owner: caller.mode === "user" ? caller.userId : null,
  });

  if (error) {
    return jsonResponse({ error: `排入更新工作失敗：${error.message}` }, 500);
  }

  // 也順手把卡住的工作放回佇列，排程跑一次就完成一輪維護。
  const { data: requeued } = await admin.rpc("requeue_stale_jobs", {});

  return jsonResponse({
    mode: caller.mode,
    max_age_hours: maxAgeHours,
    enqueued: data ?? 0,
    requeued: requeued ?? 0,
  });
});
