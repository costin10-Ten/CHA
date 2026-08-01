import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ArticlePackImport } from "@/components/import/article-pack-import";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "匯入文章包" };
export const dynamic = "force-dynamic";

const EXAMPLE = `{
  "export_meta": {
    "format": "CHA-database-aligned-export",
    "format_version": 2,
    "human_review": "completed"
  },
  "sources": [
    {
      "title": "文章標題",
      "source_type": "url",
      "origin_url": "https://example.gov.tw/article"
    }
  ],
  "source_versions": [{ "version": 1, "parser_version": "chat-workflow/1.0" }],
  "document_chunks": [
    {
      "paragraph_id": "P-004",
      "position": 4,
      "block_type": "paragraph",
      "heading_path": ["小節標題"],
      "text": "這裡要放這一段的實際文字，不能是佔位符。"
    }
  ],
  "candidate_facts": [
    {
      "ref": "C001",
      "statement": "一句一事的候選事實。",
      "knowledge_type": "substance",
      "risk_level": "medium",
      "conditions": { "population": null, "exposure_route": null, "dose": null,
                      "duration": null, "location": null, "timeframe": null },
      "source_paragraph_id": "P-004",
      "source_quote": "這裡要放段落中支持這句話的連續原文片段",
      "status": "approved"
    }
  ],
  "review_records": [
    {
      "candidate_fact_id": "$candidate_facts[C001].id",
      "action": "approve",
      "from_status": "pending",
      "to_status": "approved",
      "note": "人工核定"
    }
  ],
  "knowledge_facts": [
    {
      "ref": "F001",
      "candidate_fact_id": "$candidate_facts[C001].id",
      "statement": "一句一事的候選事實。",
      "tags": ["標籤"]
    }
  ]
}`;

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/import");

  return (
    <AppShell
      title="匯入文章包"
      description="把在對話或其他工具中整理好的一篇文章，連同段落、候選事實、審核紀錄與正式事實一次匯入。"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>上傳或貼上</CardTitle>
            <CardDescription>
              匯入前會先驗證。驗證只看結構與內容，不會寫入任何資料。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ArticlePackImport />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>檔案必須自帶原文</CardTitle>
            <CardDescription>
              這是整個系統唯一不能退讓的地方：沒有原文就無法驗證事實是否超出原文。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="font-medium text-red-900">
                以下三個欄位不能是 <code>$resolve_…</code> 這類佔位符
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-red-900">
                <li>
                  <code>document_chunks[].text</code>：該段落的實際文字
                </li>
                <li>
                  <code>candidate_facts[].source_quote</code>
                  ：段落中支持該事實的連續片段
                </li>
                <li>
                  <code>knowledge_facts[].source_quote</code>：同上
                </li>
              </ul>
              <p className="mt-2 text-xs text-red-800">
                匯入端無法從網址自動還原「是原文的哪一段、哪一句」——網頁改版、
                段落編號規則不同都會對不上，猜錯就等於偽造引用。
              </p>
            </div>

            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <p className="font-medium text-emerald-900">
                這些欄位可以留空，由系統計算
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-900">
                <li>
                  <code>content_hash</code>、<code>statement_hash</code>
                  ：一律由系統重算，才能和其他匯入路徑用同一套規則去重
                </li>
                <li>
                  <code>char_start</code>、<code>char_end</code>：依段落順序推算
                </li>
                <li>
                  <code>id</code>、<code>owner_id</code>、各種時間：由資料庫產生
                </li>
              </ul>
              <p className="mt-2 text-xs text-emerald-800">
                <code>$auth.uid()</code>、<code>$sources[0].id</code>、
                <code>$candidate_facts[C001].id</code>{" "}
                這類「綁定佔位符」是允許的，匯入時會解析成實際的 UUID。
              </p>
            </div>

            <p className="text-xs text-slate-500">
              只需要提供「有事實引用到的段落」，不需要重製整篇文章。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最小範例</CardTitle>
            <CardDescription>
              欄位名稱與列舉值與資料庫一致；未列出的欄位都有預設值。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
              {EXAMPLE}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>匯入後</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p>
              候選事實會出現在
              <Link href="/review" className="mx-1 underline">
                候選事實
              </Link>
              ；沿用人工核定結果時，正式事實會出現在
              <Link href="/knowledge" className="mx-1 underline">
                正式事實
              </Link>
              。
            </p>
            <p className="text-xs text-slate-500">
              正式事實一律由候選事實經 <code>promote_candidate_fact</code> 產生，
              版本與審核歷程才會與系統其他路徑一致。 產生後請到正式事實頁補齊向量，
              新事實才會進入搜尋與問答。
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
