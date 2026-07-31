"use server";

import { revalidatePath } from "next/cache";

import {
  SOURCES_BUCKET,
  buildOriginalPath,
  fileTicketSchema,
  isAllowedUpload,
  normalizeMimeType,
  textImportSchema,
  titleFromUrl,
  urlImportSchema,
  type ImportActionResult,
} from "@/lib/sources/schema";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * 匯入相關的 Server Actions。
 *
 * 共通原則：
 * - 每個動作都先確認登入，寫入時一律帶 owner_id，實際權限由 RLS 把關
 * - 重的工作（抓網頁、解析 PDF、切段落）不在這裡做，只建立 processing_job
 * - 檔案內容不經過本層，瀏覽器拿 signed upload URL 後直接傳 Supabase Storage
 */

const PARSE_JOB = "parse_document" as const;

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("尚未登入");
  return user;
}

/** 建立解析工作。來源建立後一定要有一筆，前端才能追蹤進度。 */
async function enqueueParseJob(sourceId: string, ownerId: string, title?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("processing_jobs").insert({
    owner_id: ownerId,
    job_type: PARSE_JOB,
    source_id: sourceId,
    payload: title ? { title } : {},
  });
  if (error) throw new Error(`建立背景工作失敗：${error.message}`);
}

export async function createTextSource(
  _prev: ImportActionResult,
  formData: FormData,
): Promise<ImportActionResult> {
  const parsed = textImportSchema.safeParse({
    title: (formData.get("title") as string) || undefined,
    text: formData.get("text"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  try {
    const user = await requireUser();
    const supabase = await createClient();

    const title = parsed.data.title?.trim() || "貼入的文字";
    const { data: source, error } = await supabase
      .from("sources")
      .insert({
        owner_id: user.id,
        title,
        source_type: "text",
        mime_type: "text/plain",
        byte_size: new Blob([parsed.data.text]).size,
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !source) {
      throw new Error(`建立來源失敗：${error?.message}`);
    }

    const path = buildOriginalPath(user.id, source.id, "original.txt");
    const { error: uploadError } = await supabase.storage
      .from(SOURCES_BUCKET)
      .upload(path, new Blob([parsed.data.text], { type: "text/plain" }), {
        upsert: true,
        contentType: "text/plain",
      });

    if (uploadError) {
      throw new Error(`保存原始文字失敗：${uploadError.message}`);
    }

    await supabase
      .from("sources")
      .update({ storage_path: path })
      .eq("id", source.id);
    await enqueueParseJob(source.id, user.id, parsed.data.title);

    revalidatePath("/sources");
    return {
      status: "success",
      message: "已建立來源，正在解析。",
      sourceId: source.id,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "匯入失敗",
    };
  }
}

export async function createUrlSource(
  _prev: ImportActionResult,
  formData: FormData,
): Promise<ImportActionResult> {
  const parsed = urlImportSchema.safeParse({
    title: (formData.get("title") as string) || undefined,
    url: formData.get("url"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data: source, error } = await supabase
      .from("sources")
      .insert({
        owner_id: user.id,
        title: parsed.data.title?.trim() || titleFromUrl(parsed.data.url),
        source_type: "url",
        origin_url: parsed.data.url,
        mime_type: "text/html",
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !source) {
      throw new Error(`建立來源失敗：${error?.message}`);
    }

    await enqueueParseJob(source.id, user.id, parsed.data.title);

    revalidatePath("/sources");
    return {
      status: "success",
      message: "已建立來源，正在抓取網頁並解析。",
      sourceId: source.id,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "匯入失敗",
    };
  }
}

export interface UploadTicket {
  sourceId: string;
  path: string;
  token: string;
}

/**
 * 步驟一：建立來源並回傳 signed upload URL。
 * 檔案本體不經過這裡，由瀏覽器直接傳到 Supabase Storage。
 */
export async function createUploadTicket(input: {
  fileName: string;
  mimeType: string;
  byteSize: number;
  title?: string;
}): Promise<{ ok: true; ticket: UploadTicket } | { ok: false; message: string }> {
  const parsed = fileTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const { fileName, mimeType, byteSize, title } = parsed.data;
  if (!isAllowedUpload(fileName, mimeType)) {
    return { ok: false, message: "只支援 .txt、.md、.html 與文字型 .pdf" };
  }

  try {
    const user = await requireUser();
    const supabase = await createClient();
    const normalizedMime = normalizeMimeType(fileName, mimeType);

    const { data: source, error } = await supabase
      .from("sources")
      .insert({
        owner_id: user.id,
        title: title?.trim() || fileName,
        source_type: "file",
        mime_type: normalizedMime,
        byte_size: byteSize,
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !source) {
      throw new Error(`建立來源失敗：${error?.message}`);
    }

    const path = buildOriginalPath(user.id, source.id, fileName);
    const { data: signed, error: signError } = await supabase.storage
      .from(SOURCES_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });

    if (signError || !signed) {
      throw new Error(`建立上傳連結失敗：${signError?.message}`);
    }

    await supabase
      .from("sources")
      .update({ storage_path: path })
      .eq("id", source.id);

    return { ok: true, ticket: { sourceId: source.id, path, token: signed.token } };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "建立上傳連結失敗",
    };
  }
}

/** 步驟二：瀏覽器上傳完成後建立解析工作。 */
export async function finalizeUpload(
  sourceId: string,
  title?: string,
): Promise<ImportActionResult> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data: source, error } = await supabase
      .from("sources")
      .select("id, storage_path")
      .eq("id", sourceId)
      .single();

    if (error || !source?.storage_path) {
      throw new Error("找不到剛上傳的檔案");
    }

    await enqueueParseJob(sourceId, user.id, title);
    revalidatePath("/sources");

    return { status: "success", message: "上傳完成，正在解析。", sourceId };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "上傳後處理失敗",
    };
  }
}

/** 重新解析：抓取最新內容並在內容變動時建立新版本。 */
export async function reparseSource(sourceId: string): Promise<ImportActionResult> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data: source, error } = await supabase
      .from("sources")
      .select("id, title")
      .eq("id", sourceId)
      .single();

    if (error || !source) throw new Error("找不到來源文件");

    await supabase.from("sources").update({ status: "pending" }).eq("id", sourceId);
    await enqueueParseJob(sourceId, user.id);

    revalidatePath(`/sources/${sourceId}`);
    revalidatePath("/sources");
    return { status: "success", message: "已排入重新解析工作。", sourceId };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "重新解析失敗",
    };
  }
}

/** 刪除來源與其 Storage 檔案。版本與段落由外鍵 cascade 一併移除。 */
export async function deleteSource(sourceId: string): Promise<ImportActionResult> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data: files } = await supabase.storage
      .from(SOURCES_BUCKET)
      .list(`${user.id}/${sourceId}`);

    if (files && files.length > 0) {
      await supabase.storage
        .from(SOURCES_BUCKET)
        .remove(files.map((file) => `${user.id}/${sourceId}/${file.name}`));
    }

    const { error } = await supabase.from("sources").delete().eq("id", sourceId);
    if (error) throw new Error(`刪除失敗：${error.message}`);

    revalidatePath("/sources");
    return { status: "success", message: "已刪除來源。", sourceId };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "刪除失敗",
    };
  }
}
