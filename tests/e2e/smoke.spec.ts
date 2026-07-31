import { expect, test } from "@playwright/test";

test("首頁顯示系統名稱與核心流程", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "個人知識庫與風險溝通產製系統" }),
  ).toBeVisible();
  await expect(page.getByText("保存原始資料與版本")).toBeVisible();
  await expect(page.getByRole("link", { name: "登入" })).toBeVisible();
});

test("首頁可導向登入頁", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("電子郵件")).toBeVisible();
});

test("登入頁提供密碼與登入連結兩種方式", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("tab", { name: "登入", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("密碼")).toBeVisible();

  await page.getByRole("tab", { name: "登入連結" }).click();
  await expect(page.getByLabel("密碼")).toHaveCount(0);
});

test("未登入時受保護路徑導回登入頁", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?redirectTo=%2Fdashboard/);
});

test("未登入時來源頁同樣受保護", async ({ page }) => {
  await page.goto("/sources");

  await expect(page).toHaveURL(/\/login\?redirectTo=%2Fsources/);
  await expect(page.getByLabel("電子郵件")).toBeVisible();
});
