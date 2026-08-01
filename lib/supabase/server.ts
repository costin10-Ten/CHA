import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Server Component / Server Action / Route Handler 使用的 Supabase client。
 * 仍然只帶 publishable key，所有權限交由 RLS 判斷。
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // 在 Server Component 中呼叫 set 會丟錯，session 更新交由 middleware 處理。
          }
        },
      },
    },
  );
}

/**
 * 取得目前登入使用者，未登入回傳 null。
 *
 * 這裡刻意不讓任何錯誤往外丟：
 * 環境變數沒設（例如 Vercel 只把變數加到 Production，Preview 沒有）
 * 或 Supabase 連不上時，整頁會變成「a server-side exception has occurred」，
 * 使用者只看得到一組 Digest，完全查不出原因。
 * 回傳 null 會讓頁面走「未登入」的正常路徑，原因則記在伺服器 log。
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured()) {
    console.error(
      "Supabase 環境變數未設定：請確認 NEXT_PUBLIC_SUPABASE_URL 與 " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 在目前的部署環境（Production／Preview／Development）都有值。",
    );
    return null;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch (cause) {
    console.error("讀取登入狀態失敗：", cause);
    return null;
  }
}
