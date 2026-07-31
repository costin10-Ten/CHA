import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getAppUrl,
  getPublicEnv,
  getServerEnv,
  isSupabaseConfigured,
} from "@/lib/env";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getPublicEnv", () => {
  it("缺少變數時丟出可讀錯誤", () => {
    expect(() => getPublicEnv()).toThrowError(/前端環境變數/);
  });

  it("設定完成時回傳解析後的值", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_0123456789abcdef";

    expect(getPublicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
    });
  });

  it("URL 格式錯誤時視為未設定", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_0123456789abcdef";

    expect(isSupabaseConfigured()).toBe(false);
  });
});

describe("getServerEnv", () => {
  it("缺少 secret key 時丟出錯誤", () => {
    process.env.SUPABASE_URL = "https://demo.supabase.co";
    expect(() => getServerEnv()).toThrowError(/伺服器環境變數/);
  });

  it("SUPABASE_URL 未設定時退回 NEXT_PUBLIC_SUPABASE_URL", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_0123456789abcdef";

    expect(getServerEnv().SUPABASE_URL).toBe("https://demo.supabase.co");
  });
});

describe("getAppUrl", () => {
  it("預設為 localhost", () => {
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("APP_URL 優先且移除尾端斜線", () => {
    process.env.APP_URL = "https://studio.example.com/";
    expect(getAppUrl()).toBe("https://studio.example.com");
  });

  it("Vercel 環境使用 VERCEL_URL", () => {
    process.env.VERCEL_URL = "preview-abc.vercel.app";
    expect(getAppUrl()).toBe("https://preview-abc.vercel.app");
  });
});
