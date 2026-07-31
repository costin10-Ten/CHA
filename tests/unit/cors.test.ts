// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CORS_HEADERS, handlePreflight, jsonResponse } from "@shared/cors.ts";

describe("handlePreflight", () => {
  it("OPTIONS 請求回 204 與 CORS 標頭", () => {
    const response = handlePreflight(
      new Request("https://x/fn", { method: "OPTIONS" }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("允許 supabase-js 會帶的標頭", () => {
    const allowed = CORS_HEADERS["access-control-allow-headers"];
    for (const header of [
      "authorization",
      "apikey",
      "x-client-info",
      "content-type",
    ]) {
      expect(allowed).toContain(header);
    }
  });

  it("POST 請求不攔截", () => {
    expect(
      handlePreflight(new Request("https://x/fn", { method: "POST" })),
    ).toBeNull();
  });
});

describe("jsonResponse", () => {
  it("所有回應都帶 CORS 標頭，瀏覽器才讀得到結果", async () => {
    const response = jsonResponse({ ok: true }, 200);

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("錯誤回應同樣帶 CORS 標頭", () => {
    const response = jsonResponse({ error: "未授權" }, 401);
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
