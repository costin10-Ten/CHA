import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * PostgREST 的 upsert 不能用在「部分唯一索引」上。
 *
 * `onConflict: "a,b"` 只會送出欄位名，帶不了索引的 where 條件，
 * Postgres 因此推斷不出要用哪個索引，回報
 * "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification"。
 *
 * 實際發生過：pkb_items 的去重索引帶 `where status <> 'trashed'`
 * （垃圾桶裡的不算重複，才能丟掉之後重新匯入），配上 upsert 就整個匯入失敗。
 * 修法是改走資料庫函式，在 SQL 裡明確指定部分索引。
 *
 * 這個測試把規則釘住：程式碼裡每一個 upsert 的 onConflict，
 * 都必須對應到一個**完整的**（非部分）唯一索引。
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
    .join("\n");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), {
    withFileTypes: true,
  })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

interface UpsertUse {
  file: string;
  table: string;
  columns: string[];
}

function findUpserts(): UpsertUse[] {
  const uses: UpsertUse[] = [];

  for (const file of [...sourceFiles("app"), ...sourceFiles("lib")]) {
    const code = readFileSync(join(process.cwd(), file), "utf8");
    // .from("table") … .upsert(…, { onConflict: "a,b" })
    const pattern =
      /\.from\(\s*["']([\w]+)["']\s*\)[\s\S]{0,400}?\.upsert\([\s\S]{0,400}?onConflict:\s*["']([^"']+)["']/g;

    for (const match of code.matchAll(pattern)) {
      uses.push({
        file,
        table: match[1],
        columns: match[2].split(",").map((column) => column.trim()),
      });
    }
  }

  return uses;
}

/** 找出這張表上、剛好蓋住這些欄位的唯一索引語句。 */
function findUniqueIndex(sql: string, table: string, columns: string[]) {
  const pattern = new RegExp(
    `create unique index[^;]*?on public\\.${table}\\s*\\(([^)]*)\\)[^;]*;`,
    "gi",
  );

  for (const match of sql.matchAll(pattern)) {
    const indexed = match[1].split(",").map((column) => column.trim());
    if (
      indexed.length === columns.length &&
      indexed.every((column, index) => column === columns[index])
    ) {
      return match[0];
    }
  }
  return null;
}

describe("upsert 的 onConflict 必須對應完整的唯一索引", () => {
  const sql = allMigrationSql();
  const uses = findUpserts();

  it("掃得到程式碼裡的 upsert（測試本身沒有失效）", () => {
    // 這個測試最大的風險是正則失效之後永遠通過，所以先確認掃得到東西。
    expect(uses.length).toBeGreaterThan(0);
  });

  it.each(findUpserts())(
    "$file：$table($columns) 有對應的唯一索引且不是部分索引",
    ({ table, columns }) => {
      const index = findUniqueIndex(sql, table, columns);

      expect(
        index,
        `找不到 ${table} (${columns.join(", ")}) 的唯一索引`,
      ).not.toBeNull();

      // 帶 where 就是部分索引，PostgREST 的 upsert 用不了。
      expect(
        /\bwhere\b/i.test(index ?? ""),
        `${table} 的唯一索引是部分索引，不能用 upsert；請改走資料庫函式`,
      ).toBe(false);
    },
  );
});

describe("pkb_items 的去重刻意是部分索引", () => {
  const sql = allMigrationSql();

  it("垃圾桶裡的不算重複，才能丟掉之後重新匯入", () => {
    const index = findUniqueIndex(sql, "pkb_items", ["owner_id", "statement_hash"]);
    expect(index).not.toBeNull();
    expect(index).toMatch(/where status <> 'trashed'/);
  });

  it("因此寫入走資料庫函式，不走 upsert", () => {
    const code = readFileSync(
      join(process.cwd(), "app", "pkb", "actions.ts"),
      "utf8",
    );
    expect(code).toContain("pkb_insert_items");
    expect(code).not.toContain('onConflict: "owner_id,statement_hash"');
  });

  it("函式在 SQL 裡明確重述部分索引的條件", () => {
    expect(sql).toMatch(
      /on conflict \(owner_id, statement_hash\) where status <> 'trashed'/,
    );
  });
});

/**
 * plpgsql 的 `returns table (...)` 會把回傳欄位名變成函式內的變數。
 *
 * 一旦函式裡有同名的資料表欄位被裸寫（沒有加限定詞），Postgres 就無法決定
 * 指的是哪一個，回報 column reference "x" is ambiguous。
 *
 * 實際發生過：pkb_insert_items 宣告 `returns table (id uuid, status ...)`，
 * 而 `on conflict (...) where status <> 'trashed'` 裡的 status 撞名，
 * 匯入整個失敗。修法是拿掉多餘的回傳欄位（改成 returns setof uuid），
 * 讓衝突不可能發生，而不是靠限定詞或 #variable_conflict 繞過。
 */
/**
 * plpgsql 的 `returns table (...)` 會把回傳欄位名變成函式內的變數。
 *
 * 一旦函式裡有同名的資料表欄位被裸寫（沒有加限定詞），Postgres 就無法決定
 * 指的是哪一個，回報 column reference "x" is ambiguous。
 *
 * 實際發生過：pkb_insert_items 宣告 `returns table (id uuid, status ...)`，
 * 而 `on conflict (...) where status <> 'trashed'` 裡的 status 撞名，
 * 匯入整個失敗。修法是拿掉多餘的回傳欄位（改成 returns setof uuid），
 * 讓衝突不可能發生，而不是靠限定詞或 #variable_conflict 繞過。
 */

interface FunctionDef {
  name: string;
  returns: string;
  columns: string[];
  body: string;
}

/**
 * 取出每個函式**目前有效的**定義。
 *
 * migration 是累積的歷史，同一個函式可能被改過好幾次；
 * 檢查應該只看最後一版，否則被修好的舊定義會永遠讓測試紅。
 */
function effectiveFunctions(): FunctionDef[] {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const latest = new Map<string, FunctionDef>();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const chunk of sql.split(/create (?:or replace )?function /i).slice(1)) {
      const name = /^([\w.]+)/.exec(chunk)?.[1];
      if (!name) continue;

      const head = chunk.split("$$")[0] ?? "";
      const body = chunk.split("$$")[1] ?? "";
      const returns = /returns ([\s\S]*?)\s*language/i.exec(head)?.[1] ?? "";
      const table = /returns table \(([\s\S]*?)\)\s*language/i.exec(head)?.[1];

      latest.set(name, {
        name,
        returns: returns.replace(/\s+/g, " ").trim(),
        // 逐個欄位取第一個字，不能靠行首——簽章寫成一行時只會抓到第一個。
        columns: (table ?? "")
          .split(",")
          .map((entry) => /^\s*(\w+)/.exec(entry)?.[1] ?? "")
          .filter(Boolean),
        body,
      });
    }
  }

  return [...latest.values()];
}

describe("plpgsql 的回傳欄位名不可與 on conflict 裡的欄位撞名", () => {
  const functions = effectiveFunctions();
  const withTable = functions.filter((fn) => fn.columns.length > 0);

  it("解析得到函式與其回傳欄位（測試本身沒有失效）", () => {
    expect(withTable.length).toBeGreaterThan(0);

    const search = withTable.find((fn) => fn.name === "public.pkb_search");
    // 欄位擷取要抓到全部，不是只有第一個。
    expect(search?.columns).toContain("id");
    expect(search?.columns).toContain("source_label");
    expect(search?.columns).toContain("combined_score");
  });

  it.each(withTable)("$name", ({ columns, body }) => {
    for (const clause of body.matchAll(/on conflict[^\n]*where ([^\n]*)/gi)) {
      for (const column of columns) {
        expect(
          new RegExp(`\\b${column}\\b`).test(clause[1]),
          `on conflict 的條件用到了與回傳欄位同名的 ${column}，會 ambiguous`,
        ).toBe(false);
      }
    }
  });

  it("pkb_insert_items 目前回傳 setof uuid，沒有具名回傳欄位", () => {
    const fn = functions.find((item) => item.name === "public.pkb_insert_items");
    expect(fn?.returns).toBe("setof uuid");
    expect(fn?.columns).toEqual([]);
  });
});
