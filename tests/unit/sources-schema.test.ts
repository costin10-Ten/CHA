import { describe, expect, it } from "vitest";

import {
  MAX_TEXT_LENGTH,
  buildOriginalPath,
  fileExtension,
  fileTicketSchema,
  isAllowedUpload,
  normalizeMimeType,
  textImportSchema,
  titleFromUrl,
  urlImportSchema,
} from "@/lib/sources/schema";

const OWNER = "11111111-1111-1111-1111-111111111111";
const SOURCE = "22222222-2222-2222-2222-222222222222";

describe("textImportSchema", () => {
  it("拒絕過短的內容", () => {
    const result = textImportSchema.safeParse({ text: "太短" });
    expect(result.success).toBe(false);
  });

  it("接受足夠長度並去除頭尾空白", () => {
    const result = textImportSchema.safeParse({
      text: "  氫氟酸是氟化氫的水溶液，接觸皮膚可能造成深層灼傷。  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text.startsWith("氫氟酸")).toBe(true);
    }
  });

  it("拒絕超過長度上限的內容", () => {
    const result = textImportSchema.safeParse({
      text: "字".repeat(MAX_TEXT_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe("urlImportSchema", () => {
  it.each(["https://example.com/a", "http://example.com"])("接受 %s", (url) => {
    expect(urlImportSchema.safeParse({ url }).success).toBe(true);
  });

  it.each(["ftp://example.com/a", "javascript:alert(1)", "example.com"])(
    "拒絕 %s",
    (url) => {
      expect(urlImportSchema.safeParse({ url }).success).toBe(false);
    },
  );
});

describe("fileTicketSchema", () => {
  it("拒絕超過 50 MB", () => {
    const result = fileTicketSchema.safeParse({
      fileName: "a.pdf",
      mimeType: "application/pdf",
      byteSize: 60 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
  });

  it("拒絕空檔案", () => {
    const result = fileTicketSchema.safeParse({
      fileName: "a.pdf",
      mimeType: "application/pdf",
      byteSize: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("isAllowedUpload", () => {
  it.each([
    ["notes.txt", "text/plain"],
    ["notes.md", "application/octet-stream"],
    ["page.html", "text/html"],
    ["report.pdf", "application/pdf"],
  ])("允許 %s", (name, mime) => {
    expect(isAllowedUpload(name, mime)).toBe(true);
  });

  it.each([
    ["photo.png", "image/png"],
    ["archive.zip", "application/zip"],
    ["sheet.xlsx", "application/vnd.ms-excel"],
  ])("拒絕 %s", (name, mime) => {
    expect(isAllowedUpload(name, mime)).toBe(false);
  });
});

describe("normalizeMimeType", () => {
  it.each([
    ["a.md", "application/octet-stream", "text/markdown"],
    ["a.pdf", "", "application/pdf"],
    ["a.htm", "text/html; charset=utf-8", "text/html"],
    ["a.txt", "text/plain", "text/plain"],
  ])("%s → %s", (name, mime, expected) => {
    expect(normalizeMimeType(name, mime)).toBe(expected);
  });
});

describe("buildOriginalPath", () => {
  it("第一層必須是 owner_id，Storage RLS 才擋得住別人的資料夾", () => {
    expect(buildOriginalPath(OWNER, SOURCE, "報告.pdf")).toBe(
      `${OWNER}/${SOURCE}/original.pdf`,
    );
  });

  it("沒有副檔名時預設 .txt", () => {
    expect(buildOriginalPath(OWNER, SOURCE, "README")).toBe(
      `${OWNER}/${SOURCE}/original.txt`,
    );
  });
});

describe("fileExtension", () => {
  it.each([
    ["a.PDF", ".pdf"],
    ["a.tar.gz", ".gz"],
    ["noext", ""],
  ])("%s → %s", (name, expected) => {
    expect(fileExtension(name)).toBe(expected);
  });
});

describe("titleFromUrl", () => {
  it("以主機名與最後一段路徑組成標題", () => {
    expect(titleFromUrl("https://example.com/health/mercury/")).toBe(
      "example.com／mercury",
    );
  });

  it("沒有路徑時只用主機名", () => {
    expect(titleFromUrl("https://example.com")).toBe("example.com");
  });
});
