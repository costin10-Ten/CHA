import { describe, expect, it } from "vitest";

import { isProtectedPath } from "@/lib/supabase/middleware";

describe("isProtectedPath", () => {
  it.each([
    "/dashboard",
    "/dashboard/anything",
    "/sources",
    "/sources/abc-123",
    "/review/1",
    "/knowledge",
    "/search",
    "/ask",
    "/verify",
    "/generate",
    "/generate/abc-123",
    "/export",
    "/history",
    "/settings/models",
    "/settings/prompts",
  ])("%s 需要登入", (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it("/api/export 由 Route Handler 自行檢查，不走 middleware 導向", () => {
    expect(isProtectedPath("/api/export")).toBe(false);
  });

  it.each(["/", "/login", "/auth/callback", "/dashboardish"])(
    "%s 不需要登入",
    (path) => {
      expect(isProtectedPath(path)).toBe(false);
    },
  );
});
