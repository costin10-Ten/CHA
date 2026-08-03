import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 部署流程的防呆。
 *
 * 起因：`db-migrate.yml` 原本會從 `claude/**` 觸發，但 Vercel 只部署 `main`。
 * 推功能分支時 migration 先套用、app 還是舊版，一個把欄位改名的 migration
 * 讓線上所有匯入都失敗——資料庫已經沒有那個欄位，程式還在寫它。
 *
 * 這個限制沒有型別或 lint 擋得住，只能靠測試把它釘住。
 */

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS, name), "utf8");
}

function pushBranches(yaml: string): string[] {
  // on: push: branches: [...] —— 只取第一個 branches，也就是 push 的那個。
  const match = /push:\s*\n\s*branches:\s*\[([^\]]*)\]/.exec(yaml);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

describe("Supabase migration 只從 main 部署", () => {
  const yaml = readWorkflow("db-migrate.yml");

  it("push 觸發分支只有 main", () => {
    expect(pushBranches(yaml)).toEqual(["main"]);
  });

  it("不從功能分支觸發", () => {
    for (const branch of ["claude/**", "feature/**", "fix/**", "develop"]) {
      expect(pushBranches(yaml), branch).not.toContain(branch);
    }
  });

  it("保留手動觸發，讓 Preview 仍可驗證新結構", () => {
    expect(yaml).toContain("workflow_dispatch");
  });

  it("檔案裡寫著為什麼只限 main", () => {
    // 這個限制看起來像是「少設定了什麼」，沒有理由的話會被好意改回去。
    expect(yaml).toContain("只從 main 觸發");
  });
});

describe("CI 仍然涵蓋功能分支", () => {
  const yaml = readWorkflow("ci.yml");

  it("功能分支照樣跑 lint／測試／build", () => {
    const branches = pushBranches(yaml);
    expect(branches).toContain("main");
    expect(branches).toContain("claude/**");
  });
});
