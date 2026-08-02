import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 工作單第 21 節裡「保證寫在資料庫」的項目。
 *
 * 這些規則不能只靠前端或 Edge Function 遵守：
 * 佇列重試、Storage 權限、混合搜尋的過濾條件、發布阻擋，
 * 都必須在 migration 裡看得到，否則任何一條呼叫路徑都可能繞過去。
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const sql = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  .join("\n");

describe("佇列失敗重試", () => {
  it("有重試上限，超過就標記為失敗", () => {
    expect(sql).toMatch(/max_attempts integer not null default \d+/);
    expect(sql).toContain("if v_job.attempts >= v_job.max_attempts then");
  });

  it("以指數退避重新排程，不是立刻重試", () => {
    expect(sql).toMatch(/interval '30 seconds' \* power\(2, v_job\.attempts - 1\)/);
  });

  it("以 FOR UPDATE SKIP LOCKED 取工作，多個 worker 不會搶到同一筆", () => {
    expect(sql).toContain("for update skip locked");
  });

  it("有把卡住的工作放回佇列的機制", () => {
    expect(sql).toContain("function public.requeue_stale_jobs");
  });
});

describe("Storage 權限", () => {
  it("以路徑第一層（owner_id）判斷，使用者只能存取自己的資料夾", () => {
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(
        sql.includes(`"sources_storage_${action}_own"`),
        `缺少 ${action} 的 Storage policy`,
      ).toBe(true);
    }
    expect(sql).toContain(
      "(storage.foldername(name))[1] = (select auth.uid())::text",
    );
  });

  it("bucket 不是公開的", () => {
    expect(sql).not.toMatch(/insert into storage\.buckets[\s\S]{0,200}true\s*\)/);
  });
});

describe("混合搜尋", () => {
  it("關鍵字、全文、三元組與向量四種訊號都在函式裡", () => {
    const fn = sql.slice(sql.indexOf("function public.search_knowledge_facts"));

    expect(fn).toContain("ilike");
    expect(fn).toContain("ts_rank_cd");
    expect(fn).toContain("similarity");
    expect(fn).toContain("operator(extensions.<=>)");
  });

  it("只回傳現行原子命題，舊版本不會混進搜尋結果", () => {
    const fn = sql.slice(sql.indexOf("function public.search_knowledge_facts"));
    expect(fn).toContain("'active'");
  });

  it("向量運算子一律加上 schema 限定，避免 search_path 找不到", () => {
    // set search_path = '' 之後，未限定的 <=> 會直接失敗（42883）。
    // 註解裡提到運算子不影響執行，比對前先去掉。
    const withoutComments = sql.replace(/--[^\n]*/g, "");
    const unqualified =
      withoutComments.match(/(?<!operator\(extensions\.)<=>/g) ?? [];
    expect(unqualified).toHaveLength(0);
  });
});

describe("發布阻擋", () => {
  it("紅色句子存在時不產生發布稿，這條規則寫在資料庫函式裡", () => {
    const fn = sql.slice(sql.indexOf("function public.apply_answer_verification"));

    expect(fn).toContain("v_unsupported = 0");
    expect(fn).toContain("'blocked'");
  });

  it("沒有原文片段的候選原子命題不得寫入正式原子命題庫", () => {
    const fn = sql.slice(sql.indexOf("function public.promote_candidate_fact"));

    expect(fn).toContain("缺少原文片段的原子命題不得寫入正式原子命題庫");
    expect(fn).toContain("只有已核定的候選原子命題可以寫入正式原子命題庫");
  });
});

describe("向量增量更新", () => {
  it("沒有任何一次性重建全部向量的語句", () => {
    expect(sql).not.toMatch(/delete from public\.embedding_records\s*;/i);
    expect(sql).not.toMatch(/truncate\s+(table\s+)?public\.embedding_records/i);
  });

  it("索引只涵蓋現行向量", () => {
    expect(sql).toMatch(
      /create index if not exists embedding_records_vector_idx[\s\S]*?where is_active/,
    );
  });
});
