import { NextResponse, type NextRequest } from "next/server";

import {
  PKB_EXPORT_CONTENT_TYPE,
  PKB_EXPORT_EXTENSION,
  buildPkbExport,
  type PkbExportFormat,
} from "@/lib/pkb/export";
import { listActivePkbItems } from "@/lib/pkb/queries";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * 匯出已同意的原子知識，供其他 LLM 問答使用。
 *
 * 只回傳 status = active 的內容：待同意的還沒過關，垃圾桶的已經被丟掉。
 * 走登入使用者的 session，RLS 保證只拿得到自己的知識。
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "尚未登入" }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("format");
  const format: PkbExportFormat = raw === "jsonl" ? "jsonl" : "markdown";

  try {
    const items = await listActivePkbItems();
    const exportedAt = new Date().toISOString();
    const body = buildPkbExport(items, format, exportedAt);

    const date = exportedAt.slice(0, 10);
    const filename = `個人原子知識庫-${date}.${PKB_EXPORT_EXTENSION[format]}`;

    return new NextResponse(body, {
      headers: {
        "Content-Type": PKB_EXPORT_CONTENT_TYPE[format],
        // 中文檔名要用 RFC 5987 的 filename*，否則某些瀏覽器會存成亂碼。
        "Content-Disposition": `attachment; filename="pkb-${date}.${PKB_EXPORT_EXTENSION[format]}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "匯出失敗" },
      { status: 500 },
    );
  }
}
