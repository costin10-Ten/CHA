import { describe, expect, it } from "vitest";

import { validateArticlePack } from "@shared/article-pack.ts";

import { DEMO_ARTICLES, toArticlePack } from "@/lib/demo/articles";

/**
 * 示範資料必須通過與一般匯入完全相同的驗證。
 * 特別是原文引句要真的是段落的連續片段——寫錯了這裡會直接抓到。
 */
describe("示範資料（工作單第 22 節）", () => {
  it("三篇：氫氟酸、汞、蘇丹紅", () => {
    expect(DEMO_ARTICLES).toHaveLength(3);
    const titles = DEMO_ARTICLES.map((article) => article.title).join(" ");
    expect(titles).toContain("氫氟酸");
    expect(titles).toContain("汞");
    expect(titles).toContain("蘇丹紅");
  });

  it.each(DEMO_ARTICLES.map((article) => [article.title, article] as const))(
    "%s 通過文章包驗證",
    (_title, article) => {
      const result = validateArticlePack(toArticlePack(article));
      const errors = result.issues.filter((issue) => issue.level === "error");

      expect(
        errors.map((issue) => `${issue.where}：${issue.message}`).join("\n"),
      ).toBe("");
      expect(result.ok).toBe(true);
    },
  );

  it.each(DEMO_ARTICLES.map((article) => [article.title, article] as const))(
    "%s 的數量符合工作單要求",
    (_title, article) => {
      const count = (status: string) =>
        article.candidates.filter((candidate) => candidate.status === status)
          .length;

      expect(article.candidates.length).toBeGreaterThanOrEqual(10);
      expect(count("approved")).toBeGreaterThanOrEqual(6);
      expect(count("needs_fix")).toBeGreaterThanOrEqual(2);
      expect(count("rejected")).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(DEMO_ARTICLES.map((article) => [article.title, article] as const))(
    "%s 的核定事實有主體與客體，才能產生實體與關聯",
    (_title, article) => {
      const approved = article.candidates.filter(
        (candidate) => candidate.status === "approved",
      );

      for (const candidate of approved) {
        expect(candidate.subject.length, candidate.ref).toBeGreaterThan(0);
        expect(candidate.object.length, candidate.ref).toBeGreaterThan(0);
      }

      // promote_candidate_fact 會從主體與客體建立實體，因此至少要有 3 個不同名稱。
      const names = new Set(
        approved.flatMap((candidate) => [candidate.subject, candidate.object]),
      );
      expect(names.size).toBeGreaterThanOrEqual(3);
    },
  );

  it("被駁回的示範事實都寫明了駁回理由", () => {
    for (const article of DEMO_ARTICLES) {
      for (const candidate of article.candidates) {
        if (candidate.status === "rejected" || candidate.status === "needs_fix") {
          expect(
            candidate.review_note,
            `${article.slug} ${candidate.ref}`,
          ).toBeTruthy();
        }
      }
    }
  });
});
