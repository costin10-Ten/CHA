import { describe, expect, it } from "vitest";

import {
  credentialsSchema,
  magicLinkSchema,
  toFriendlyAuthError,
} from "@/lib/auth/schema";

describe("credentialsSchema", () => {
  it("接受合法的電子郵件與密碼", () => {
    const result = credentialsSchema.safeParse({
      email: "  user@example.com  ",
      password: "supersecret",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("拒絕格式錯誤的電子郵件", () => {
    const result = credentialsSchema.safeParse({
      email: "not-an-email",
      password: "supersecret",
    });

    expect(result.success).toBe(false);
  });

  it("拒絕過短的密碼", () => {
    const result = credentialsSchema.safeParse({
      email: "user@example.com",
      password: "short",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("8");
    }
  });
});

describe("magicLinkSchema", () => {
  it("只需要電子郵件", () => {
    expect(magicLinkSchema.safeParse({ email: "user@example.com" }).success).toBe(
      true,
    );
  });
});

describe("toFriendlyAuthError", () => {
  it("翻譯已知錯誤", () => {
    expect(toFriendlyAuthError("Invalid login credentials")).toBe(
      "電子郵件或密碼錯誤",
    );
  });

  it("未知錯誤原樣回傳", () => {
    expect(toFriendlyAuthError("Something else")).toBe("Something else");
  });
});
