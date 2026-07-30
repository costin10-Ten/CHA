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
    "/history",
    "/settings/models",
  ])("%s 需要登入", (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each(["/", "/login", "/auth/callback", "/dashboardish"])(
    "%s 不需要登入",
    (path) => {
      expect(isProtectedPath(path)).toBe(false);
    },
  );
});
