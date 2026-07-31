import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 這些是工作單第 11、12 節的硬性規則，寫成測試避免日後改壞：
 * - 修改事實時舊版標為 superseded、只停用該筆向量
 * - 不得重建全部向量
 * - 只有現行向量參與索引
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

const sql = readMigrations();

describe("正式事實版本規則", () => {
  it("修改事實會把舊版標為 superseded", () => {
    expect(sql).toMatch(/set status = 'superseded', superseded_by = v_new_id/);
  });

  it("新版本從舊版 version + 1 起算", () => {
    expect(sql).toContain("v_old.version + 1");
  });

  it("每一版都寫入 fact_versions 快照", () => {
    expect(sql).toMatch(/insert into public\.fact_versions/);
  });
});

describe("向量增量更新規則", () => {
  it("修改事實時只停用該筆事實的向量", () => {
    expect(sql).toMatch(
      /update public\.embedding_records\s+set is_active = false\s+where knowledge_fact_id = v_old\.id and is_active/,
    );
  });

  it("沒有任何一次性刪除全部向量的語句", () => {
    expect(sql).not.toMatch(/delete from public\.embedding_records\s*;/i);
    expect(sql).not.toMatch(/truncate\s+(table\s+)?public\.embedding_records/i);
  });

  it("修改後只為新版本排入一筆向量工作", () => {
    const revise = sql.slice(sql.indexOf("revise_knowledge_fact"));
    const jobInserts = revise.match(/insert into public\.processing_jobs/g) ?? [];
    expect(jobInserts.length).toBe(1);
    expect(revise).toContain("'knowledge_fact_id', v_new_id");
  });

  it("向量索引只涵蓋現行向量", () => {
    expect(sql).toMatch(
      /create index if not exists embedding_records_vector_idx[\s\S]*?where is_active/,
    );
  });
});

describe("正式事實的來源約束", () => {
  it("沒有原文片段的候選事實不得寫入正式事實庫", () => {
    expect(sql).toContain("缺少原文片段的事實不得寫入正式事實庫");
  });

  it("只有已核定的候選事實可以寫入", () => {
    expect(sql).toContain("只有已核定的候選事實可以寫入正式事實庫");
  });

  it("source_quote 與 source_paragraph_id 都是必填", () => {
    const table = sql.slice(
      sql.indexOf("create table if not exists public.knowledge_facts"),
      sql.indexOf(
        ");",
        sql.indexOf("create table if not exists public.knowledge_facts"),
      ),
    );
    expect(table).toMatch(/source_paragraph_id text not null/);
    expect(table).toMatch(/source_quote text not null/);
  });
});
