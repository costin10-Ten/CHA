import { z } from "zod";

/**
 * 環境變數集中驗證。
 *
 * 分成三組：
 * - publicEnv：可安全暴露在瀏覽器（NEXT_PUBLIC_ 前綴）
 * - serverEnv：僅限 Server Actions / Route Handlers / Edge Functions
 * - 所有讀取都是延遲執行，避免 build 期間因缺少變數而整包失敗
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

const serverSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(20),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}

/**
 * 取得前端可用的環境變數。
 * 注意：Next.js 只會在編譯期替換「靜態寫死」的 process.env.NEXT_PUBLIC_* 存取，
 * 因此這裡必須逐一列出，不能用動態 key。
 */
export function getPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `缺少或不合法的前端環境變數（請參考 .env.example）：${formatIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

/** 取得僅限伺服器端使用的環境變數。永遠不要在 client component 呼叫。 */
export function getServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `缺少或不合法的伺服器環境變數（請參考 .env.example）：${formatIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

/** 應用程式對外網址，供 Auth redirect 使用。 */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

/** 供 UI 判斷是否已完成 Supabase 設定，未設定時顯示引導畫面而不是直接崩潰。 */
export function isSupabaseConfigured(): boolean {
  return (
    publicSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    }).success === true
  );
}
