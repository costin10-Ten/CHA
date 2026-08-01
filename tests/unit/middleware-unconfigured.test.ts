import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * 迴歸測試：Vercel 只把環境變數加到 Production 時，
 * Preview Deployment 讀不到值。
 *
 * 這種情況下需要登入的頁面會呼叫 getCurrentUser() → getPublicEnv() → 丟例外，
 * 使用者只看到「a server-side exception has occurred」加一組 Digest。
 * middleware 必須先把這些請求導回首頁，讓使用者看到設定指引。
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://preview.vercel.app"));
}

describe("環境變數未設定時的 middleware", () => {
  it.each(["/dashboard", "/generate", "/export", "/settings/prompts", "/review/1"])(
    "%s 導回首頁並標記需要設定，而不是讓頁面整頁失敗",
    async (path) => {
      const response = await updateSession(request(path));

      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/");
      expect(location.searchParams.get("setup")).toBe("required");
    },
  );

  it("首頁與登入頁仍然可以開啟，才能顯示設定指引", async () => {
    for (const path of ["/", "/login"]) {
      const response = await updateSession(request(path));
      expect(response.status).toBe(200);
    }
  });
});
