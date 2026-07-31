import { z } from "zod";

/** Storage bucket 名稱，與 migration 中建立的 bucket 一致。 */
export const SOURCES_BUCKET = "sources";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 500_000;

/** 允許上傳的檔案型別（工作單第 5 節）。 */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/html",
  "application/pdf",
] as const;

export const ALLOWED_UPLOAD_EXTENSIONS = [".txt", ".md", ".html", ".htm", ".pdf"];

export const textImportSchema = z.object({
  title: z.string().trim().max(200, "標題過長").optional(),
  text: z
    .string()
    .trim()
    .min(20, "內容太短，至少 20 個字才能拆出可驗證的事實")
    .max(MAX_TEXT_LENGTH, "內容超過 50 萬字，請分批匯入"),
});

export const urlImportSchema = z.object({
  title: z.string().trim().max(200, "標題過長").optional(),
  url: z
    .string()
    .trim()
    .url("網址格式不正確")
    .refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      "只接受 http 或 https 網址",
    ),
});

export const fileTicketSchema = z.object({
  fileName: z.string().trim().min(1, "缺少檔名").max(255, "檔名過長"),
  mimeType: z.string().trim().min(1, "缺少檔案型別"),
  byteSize: z
    .number()
    .int()
    .positive("檔案是空的")
    .max(MAX_UPLOAD_BYTES, "檔案超過 50 MB"),
  title: z.string().trim().max(200, "標題過長").optional(),
});

export type TextImportInput = z.infer<typeof textImportSchema>;
export type UrlImportInput = z.infer<typeof urlImportSchema>;
export type FileTicketInput = z.infer<typeof fileTicketSchema>;

export type ImportActionResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string; sourceId: string };

/** 副檔名（含點），無副檔名時回傳空字串。 */
export function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index).toLowerCase();
}

export function isAllowedUpload(fileName: string, mimeType: string): boolean {
  const extension = fileExtension(fileName);
  const mimeOk = (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(
    mimeType.split(";")[0].trim(),
  );
  const extensionOk = ALLOWED_UPLOAD_EXTENSIONS.includes(extension);
  // 瀏覽器對 .md 常回報 application/octet-stream，因此副檔名符合即可放行。
  return mimeOk || extensionOk;
}

/** 將瀏覽器回報的 MIME 正規化，供解析器判斷格式。 */
export function normalizeMimeType(fileName: string, mimeType: string): string {
  const extension = fileExtension(fileName);
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".txt") return "text/plain";
  const base = mimeType.split(";")[0].trim();
  return base || "text/plain";
}

/** Storage 路徑：{owner_id}/{source_id}/original.<ext> */
export function buildOriginalPath(
  ownerId: string,
  sourceId: string,
  fileName: string,
): string {
  const extension = fileExtension(fileName) || ".txt";
  return `${ownerId}/${sourceId}/original${extension}`;
}

/** 由網址推測標題（去掉協定與結尾斜線）。 */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    const last = path.split("/").filter(Boolean).pop();
    return last
      ? `${parsed.hostname}／${decodeURIComponent(last)}`
      : parsed.hostname;
  } catch {
    return url.slice(0, 120);
  }
}
