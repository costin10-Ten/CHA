import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * 具有 service role 權限的 client，會繞過 RLS。
 *
 * 僅限背景工作（queue worker、cron、系統性維運）使用，
 * 且每次查詢都必須自行帶入 owner_id 條件。
 * 絕對不可在任何 client component 匯入。
 */
export function createAdminClient() {
  const env = getServerEnv();

  return createSupabaseClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
