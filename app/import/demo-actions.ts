"use server";

import { revalidatePath } from "next/cache";

import { generateDraft } from "@/app/generate/actions";
import { importArticlePack } from "@/app/import/actions";
import {
  DEMO_ARTICLES,
  DEMO_DRAFT_TYPES,
  toArticlePack,
} from "@/lib/demo/articles";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * 載入示範資料（工作單第 22 節）。
 *
 * 走與一般匯入完全相同的路徑：同一個驗證器、同一個匯入流程、
 * 正式事實一樣經 promote_candidate_fact 產生。
 * 示範資料因此不是特例，而是這條流程本身的證明。
 */

export type DemoResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string; details: string[] };

export async function loadDemoData(): Promise<DemoResult> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("尚未登入");

    const details: string[] = [];
    let imported = 0;
    let drafts = 0;

    for (const article of DEMO_ARTICLES) {
      const pack = JSON.stringify(toArticlePack(article));
      const result = await importArticlePack(pack, { trustHumanReview: true });

      if (result.status !== "success") {
        details.push(
          `${article.title}：${result.status === "error" ? result.message : "未執行"}`,
        );
        continue;
      }

      imported += 1;
      details.push(
        `${article.title}：${result.created.chunks} 段原文、${result.created.candidates} 筆候選事實、${result.created.knowledgeFacts} 筆正式事實`,
      );

      // 用這篇文章的核定事實產製素材，不做跨文章檢索，
      // 示範資料才會與來源一一對應。
      const supabase = await createClient();
      const { data: facts } = await supabase
        .from("knowledge_facts")
        .select("id")
        .in("source_id", result.sourceIds)
        .eq("status", "active");

      const factIds = (facts ?? []).map((fact) => fact.id);
      if (factIds.length === 0) continue;

      for (const draftType of DEMO_DRAFT_TYPES) {
        const draft = await generateDraft({
          draftType,
          topic: article.topic,
          audience: "一般民眾",
          tone: "平實",
          factIds,
        });

        if (draft.status === "success") drafts += 1;
        else if (draft.status === "error") {
          details.push(`${article.title}／${draftType}：${draft.message}`);
        }
      }
    }

    if (imported === 0) {
      return {
        status: "error",
        message: `示範資料沒有匯入任何一篇。${details[0] ?? ""}`,
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/sources");
    revalidatePath("/review");
    revalidatePath("/knowledge");
    revalidatePath("/generate");

    return {
      status: "success",
      details,
      message: `已載入 ${imported} 篇示範文章與 ${drafts} 份素材草稿。可到候選事實、正式事實與素材頁檢視。`,
    };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "載入示範資料失敗",
    };
  }
}
