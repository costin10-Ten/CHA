import { describe, expect, it } from "vitest";

import { activeHref } from "@/components/app-shell-nav";

/**
 * 導覽列的「目前在哪一頁」。
 *
 * 兩個容易寫錯的地方：
 * 1. 純前綴比對會讓 /pkb 把 /pkbxxx 也算成自己
 * 2. /pkb 與 /pkb/import 同時命中時，要取最長的那一個，
 *    否則進到子頁時父項也亮著，看不出實際位置
 */
const HREFS = [
  "/dashboard",
  "/import",
  "/search",
  "/pkb",
  "/pkb/import",
  "/pkb/search",
  "/pkb/export",
  "/pkb/trash",
];

describe("activeHref", () => {
  it("完全相同時命中", () => {
    expect(activeHref("/pkb", HREFS)).toBe("/pkb");
    expect(activeHref("/dashboard", HREFS)).toBe("/dashboard");
  });

  it("子頁命中最長的那一個，不會連父項一起亮", () => {
    expect(activeHref("/pkb/import", HREFS)).toBe("/pkb/import");
    expect(activeHref("/pkb/trash", HREFS)).toBe("/pkb/trash");
  });

  it("更深的子路徑歸給最接近的項目", () => {
    expect(activeHref("/pkb/search/advanced", HREFS)).toBe("/pkb/search");
  });

  it("前綴相同但不是子路徑時不命中", () => {
    // 這是純字串 startsWith 會出錯的地方。
    expect(activeHref("/pkbxxx", HREFS)).toBeNull();
    expect(activeHref("/importer", HREFS)).toBeNull();
  });

  it("兩套系統的搜尋頁不會互相誤判", () => {
    expect(activeHref("/search", HREFS)).toBe("/search");
    expect(activeHref("/pkb/search", HREFS)).toBe("/pkb/search");
  });

  it("沒有對應項目時回傳 null", () => {
    expect(activeHref("/login", HREFS)).toBeNull();
    expect(activeHref("/", HREFS)).toBeNull();
  });
});
