import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().min(1, "請輸入電子郵件").email("電子郵件格式不正確"),
  password: z.string().min(8, "密碼至少 8 個字元").max(72, "密碼過長"),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export const magicLinkSchema = credentialsSchema.pick({ email: true });

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;

export type AuthActionResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/** 將 Supabase 回傳的錯誤訊息轉成使用者看得懂的中文。 */
export function toFriendlyAuthError(message: string): string {
  const map: Record<string, string> = {
    "Invalid login credentials": "電子郵件或密碼錯誤",
    "Email not confirmed": "電子郵件尚未完成驗證，請先點擊信中的確認連結",
    "User already registered": "此電子郵件已註冊，請直接登入",
    "Signups not allowed for this instance": "此站台已關閉註冊",
  };
  return map[message] ?? message;
}
