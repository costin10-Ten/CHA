import { createClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

/**
 * 取得目前使用者的 profile。
 *
 * profile 由資料庫 trigger（handle_new_user）於註冊時建立；
 * 若因故不存在（例如使用者在 trigger 建立前就被匯入），這裡補寫一筆。
 * 所有查詢都經過 RLS，只會命中自己的資料。
 */
export async function getOrCreateProfile(
  userId: string,
): Promise<ProfileRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`讀取 profile 失敗：${error.message}`);
  }

  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from("profiles")
    .insert({ owner_id: userId })
    .select("*")
    .single();

  if (insertError) {
    throw new Error(`建立 profile 失敗：${insertError.message}`);
  }

  return inserted;
}
