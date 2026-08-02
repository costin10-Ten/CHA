import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 這些是工作單第 11、12 節的硬性規則，寫成測試避免日後改壞：
 * - 修改原子命題時舊版標為 superseded、只停用該筆向量
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

describe("正式原子命題版本規則", () => {
  it("修改原子命題會把舊版標為 superseded", () => {
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
  it("修改原子命題時只停用該筆原子命題的向量", () => {
    expect(sql).toMatch(
      /update public\.embedding_records\s+set is_active = false\s+where knowledge_fact_id = v_old\.id and is_active/,
    );
  });

  it("沒有任何一次性刪除全部向量的語句", () => {
    expect(sql).not.toMatch(/delete from public\.embedding_records\s*;/i);
    expect(sql).not.toMatch(/truncate\s+(table\s+)?public\.embedding_records/i);
  });

  it("修改後只為新版本排入一筆向量工作", () => {
    // 只看 revise_knowledge_fact 這一個函式的內容，
    // 否則後面 migration 裡其他函式排入的工作也會被算進來。
    const start = sql.indexOf("function public.revise_knowledge_fact");
    const revise = sql.slice(start, sql.indexOf("$$;", start));
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

describe("正式原子命題的來源約束", () => {
  it("沒有原文片段的候選原子命題不得寫入正式原子命題庫", () => {
    expect(sql).toContain("缺少原文片段的原子命題不得寫入正式原子命題庫");
  });

  it("只有已核定的候選原子命題可以寫入", () => {
    expect(sql).toContain("只有已核定的候選原子命題可以寫入正式原子命題庫");
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

describe("混合搜尋的安全限制", () => {
  const search = sql.slice(sql.indexOf("function public.search_knowledge_facts"));

  it("一律限制 owner_id 為目前使用者", () => {
    expect(search).toContain("f.owner_id = (select auth.uid())");
  });

  it("只搜尋現行原子命題", () => {
    expect(search).toContain("f.status = 'active'");
  });

  it("向量只取現行向量", () => {
    expect(search).toMatch(/where e\.knowledge_fact_id = b\.id\s+and e\.is_active/);
  });

  it("同時具備關鍵字、全文與向量三種比對", () => {
    expect(search).toContain("ilike");
    expect(search).toContain("ts_rank_cd");
    expect(search).toContain("extensions.similarity");
    expect(search).toContain("<=>");
  });

  it("支援文件、類型、風險與實體篩選", () => {
    for (const filter of [
      "p_source_id is null or f.source_id = p_source_id",
      "p_proposition_type is null",
      "p_risk_level is null or f.risk_level = p_risk_level",
      "p_entity_id is null",
    ]) {
      expect(search).toContain(filter);
    }
  });
});

describe("search_path 為空的函式必須限定擴充運算子", () => {
  it("pgvector 的 <=> 一律以 operator(extensions.<=>) 呼叫", () => {
    // search_path = '' 時未限定的擴充運算子會出現
    // 42883 operator does not exist: extensions.vector <=> extensions.vector
    const unqualified = sql
      .split("\n")
      .filter((line) => line.includes("<=>") && !line.trim().startsWith("--"))
      .filter((line) => !line.includes("operator(extensions.<=>)"));

    expect(unqualified).toEqual([]);
  });
});
