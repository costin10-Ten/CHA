import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readAllMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

function createdTables(sql: string): string[] {
  const matches = sql.matchAll(
    /create table (?:if not exists )?public\.([a-z0-9_]+)/gi,
  );
  return [...matches].map((match) => match[1]);
}

describe("migrations", () => {
  const sql = readAllMigrations();

  it("至少有一個 migration 檔", () => {
    expect(
      readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length,
    ).toBeGreaterThan(0);
  });

  it("每張 public 資料表都啟用 RLS", () => {
    for (const table of createdTables(sql)) {
      expect(
        sql.includes(`alter table public.${table} enable row level security`),
        `public.${table} 未啟用 RLS`,
      ).toBe(true);
    }
  });

  it("每張 public 資料表都有 owner_id、created_at、updated_at", () => {
    for (const table of createdTables(sql)) {
      const body = sql.slice(
        sql.indexOf(`public.${table} (`),
        sql.indexOf(");", sql.indexOf(`public.${table} (`)),
      );
      expect(body, `public.${table} 缺少 owner_id`).toContain("owner_id");
      expect(body, `public.${table} 缺少 created_at`).toContain("created_at");
      expect(body, `public.${table} 缺少 updated_at`).toContain("updated_at");
    }
  });

  it("沒有任何 migration 關閉 RLS", () => {
    expect(sql).not.toMatch(/disable row level security/i);
  });
});
