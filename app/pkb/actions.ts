"use server";

import { revalidatePath } from "next/cache";

import { sha256Hex } from "@shared/hash.ts";
import { createEmbeddingProvider } from "@shared/llm/embeddings.ts";
import { validatePkbPack, type PkbIssue } from "@shared/pkb-pack.ts";
import { normalizeForCompare } from "@shared/quality.ts";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { PkbSourceType } from "@/lib/supabase/types";

/**
 * 個人原子知識庫的寫入動作。
 *
 * 「同意」「丟垃圾桶」「還原」都走資料庫函式，狀態、時間戳、圖譜與向量
 * 才會一起改動——分散在應用層做，遲早會出現「已同意但沒有同意時間」
 * 或「在垃圾桶裡卻還搜得到」這種對不起來的狀態。
 */

export type PkbResult =
  | { status: "idle" }
  | { status: "error"; message: string; issues?: PkbIssue[] }
  | { status: "success"; message: string; issues?: PkbIssue[] };

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("尚未登入");
  return user;
}

function revalidatePkb() {
  revalidatePath("/pkb");
  revalidatePath("/pkb/trash");
  revalidatePath("/pkb/search");
}

function toError(cause: unknown): PkbResult {
  return {
    status: "error",
    message: cause instanceof Error ? cause.message : "操作失敗",
  };
}

// --- 匯入 ------------------------------------------------------------------

export async function importPkbPack(
  json: string,
  options: { filename?: string; trustPackApproval?: boolean } = {},
): Promise<PkbResult> {
  try {
    const user = await requireUser();

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (cause) {
      return {
        status: "error",
        message: `JSON 格式有誤：${cause instanceof Error ? cause.message : "無法解析"}`,
      };
    }

    const validation = validatePkbPack(parsed);
    if (!validation.ok) {
      return {
        status: "error",
        message: "檔案裡沒有任何可匯入的原子知識，沒有寫入任何資料。",
        issues: validation.issues,
      };
    }

    const supabase = await createClient();

    const { data: batch, error: batchError } = await supabase
      .from("pkb_import_batches")
      .insert({
        owner_id: user.id,
        filename: options.filename ?? null,
        item_count: validation.summary.items,
        skipped_count: validation.summary.skipped + validation.summary.rejected,
        note: validation.defaultSourceLabel,
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      throw new Error(`建立匯入批次失敗：${batchError?.message}`);
    }

    const now = new Date().toISOString();
    const rows = await Promise.all(
      validation.items.map(async (item) => ({
        owner_id: user.id,
        import_batch_id: batch.id,
        statement: item.statement,
        source_type: item.source_type as PkbSourceType,
        source_label: item.source_label,
        source_url: item.source_url,
        source_note: item.source_note,
        is_self_authored: item.is_self_authored,
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        tags: item.tags,
        // 檔案標示已同意，且使用者勾了「沿用」才直接生效。
        status:
          options.trustPackApproval && item.approved_in_pack
            ? ("active" as const)
            : ("draft" as const),
        approved_at:
          options.trustPackApproval && item.approved_in_pack ? now : null,
        statement_hash: await sha256Hex(normalizeForCompare(item.statement)),
      })),
    );

    // 已經收過的同一句話會撞上唯一索引，忽略即可——重複匯入是常態。
    const { data: inserted, error: insertError } = await supabase
      .from("pkb_items")
      .upsert(rows, {
        onConflict: "owner_id,statement_hash",
        ignoreDuplicates: true,
      })
      .select("id, status, subject, predicate, object");

    if (insertError) throw new Error(`寫入失敗：${insertError.message}`);

    const created = inserted ?? [];
    const duplicates = rows.length - created.length;

    if (created.length > 0) {
      await supabase.from("pkb_review_log").insert(
        created.map((row) => ({
          owner_id: user.id,
          item_id: row.id,
          action: "import" as const,
          to_status: row.status,
          note: options.filename ?? null,
        })),
      );
    }

    // 匯入時就同意的，補建圖譜與向量工作。
    for (const row of created) {
      if (row.status === "active") {
        await supabase.rpc("pkb_approve_item", {
          p_item_id: row.id,
          p_note: "匯入時沿用檔案的同意結果",
        });
      }
    }

    revalidatePkb();

    const notes = [
      duplicates > 0 ? `${duplicates} 筆已經收過，略過` : "",
      validation.summary.rejected > 0
        ? `${validation.summary.rejected} 筆標示駁回，未匯入`
        : "",
      validation.summary.skipped > 0
        ? `${validation.summary.skipped} 筆缺欄位被跳過`
        : "",
    ].filter(Boolean);

    return {
      status: "success",
      message: `已匯入 ${created.length} 筆原子知識${
        notes.length > 0 ? `（${notes.join("、")}）` : ""
      }。`,
      issues: validation.issues,
    };
  } catch (cause) {
    return toError(cause);
  }
}

// --- 同意／垃圾桶 -----------------------------------------------------------

export async function approvePkbItem(
  id: string,
  note?: string,
): Promise<PkbResult> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("pkb_approve_item", {
      p_item_id: id,
      p_note: note ?? null,
    });
    if (error) throw new Error(error.message);

    revalidatePkb();
    return { status: "success", message: "已同意，這筆知識進入搜尋範圍。" };
  } catch (cause) {
    return toError(cause);
  }
}

export async function trashPkbItem(
  id: string,
  reason?: string,
): Promise<PkbResult> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("pkb_trash_item", {
      p_item_id: id,
      p_reason: reason ?? null,
    });
    if (error) throw new Error(error.message);

    revalidatePkb();
    return { status: "success", message: "已丟進垃圾桶，清單不再顯示。" };
  } catch (cause) {
    return toError(cause);
  }
}

export async function restorePkbItem(id: string): Promise<PkbResult> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("pkb_restore_item", { p_item_id: id });
    if (error) throw new Error(error.message);

    revalidatePkb();
    return {
      status: "success",
      message: "已還原成待同意。既然丟過一次，請再看一眼再同意。",
    };
  } catch (cause) {
    return toError(cause);
  }
}

/** 批次同意／批次丟垃圾桶。只作用於還沒做決定的（draft）。 */
export async function batchPkbAction(
  ids: string[],
  action: "approve" | "trash",
  note?: string,
): Promise<PkbResult> {
  try {
    await requireUser();
    if (ids.length === 0) {
      return { status: "error", message: "沒有選取任何項目" };
    }

    const supabase = await createClient();
    const { data: items } = await supabase
      .from("pkb_items")
      .select("id, status")
      .in("id", ids);

    // 批次操作不該有能力翻掉已經做過的判斷——同 CHA 的教訓。
    const targets = (items ?? []).filter((item) => item.status === "draft");
    if (targets.length === 0) {
      return {
        status: "error",
        message: "選取的項目都不是待同意狀態。要改判請用單筆操作。",
      };
    }

    for (const item of targets) {
      const { error } =
        action === "approve"
          ? await supabase.rpc("pkb_approve_item", {
              p_item_id: item.id,
              p_note: note ?? "批次同意",
            })
          : await supabase.rpc("pkb_trash_item", {
              p_item_id: item.id,
              p_reason: note ?? "批次丟垃圾桶",
            });
      if (error) throw new Error(error.message);
    }

    revalidatePkb();
    const skipped = ids.length - targets.length;
    return {
      status: "success",
      message: `已處理 ${targets.length} 筆${
        skipped > 0 ? `，${skipped} 筆因狀態不允許而略過` : ""
      }。`,
    };
  } catch (cause) {
    return toError(cause);
  }
}

// --- 向量 ------------------------------------------------------------------

/**
 * 為已同意但還沒有向量的知識補齊向量。
 *
 * 增量：只做缺的那些，不重建整個索引。
 * 沒有設定金鑰時走 mock provider，仍然可以驗證整條流程。
 */
export async function backfillPkbEmbeddings(): Promise<PkbResult> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data: items } = await supabase
      .from("pkb_items")
      .select("id, statement")
      .eq("status", "active");

    if (!items || items.length === 0) {
      return { status: "success", message: "沒有已同意的原子知識，不需要補齊。" };
    }

    const { data: existing } = await supabase
      .from("pkb_embeddings")
      .select("item_id")
      .eq("is_active", true)
      .in(
        "item_id",
        items.map((item) => item.id),
      );

    const done = new Set((existing ?? []).map((row) => row.item_id));
    const pending = items.filter((item) => !done.has(item.id));

    if (pending.length === 0) {
      return { status: "success", message: "向量已經是最新的。" };
    }

    const provider = createEmbeddingProvider({
      provider:
        process.env.EMBEDDING_PROVIDER ?? process.env.LLM_PROVIDER ?? "mock",
      model: process.env.EMBEDDING_MODEL || undefined,
      apiKey: process.env.OPENAI_API_KEY || undefined,
      baseUrl: process.env.LLM_BASE_URL || undefined,
    });

    // 一次一批，避免單次請求過大。
    const BATCH = 32;
    let embedded = 0;

    for (let index = 0; index < pending.length; index += BATCH) {
      const slice = pending.slice(index, index + BATCH);
      const vectors = await provider.embed(slice.map((item) => item.statement));

      const rows = await Promise.all(
        slice.map(async (item, offset) => ({
          owner_id: user.id,
          item_id: item.id,
          embedding: JSON.stringify(vectors[offset]),
          embedding_model: provider.model,
          content_hash: await sha256Hex(normalizeForCompare(item.statement)),
          is_active: true,
        })),
      );

      const { error } = await supabase.from("pkb_embeddings").insert(rows);
      if (error) throw new Error(`寫入向量失敗：${error.message}`);
      embedded += rows.length;
    }

    revalidatePkb();
    return {
      status: "success",
      message: `已補齊 ${embedded} 筆向量，這些知識現在可以用語意搜尋找到。`,
    };
  } catch (cause) {
    return toError(cause);
  }
}
