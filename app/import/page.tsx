import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ArticlePackImport } from "@/components/import/article-pack-import";
import { SourceWithPack } from "@/components/import/source-with-pack";
import { DemoLoader } from "@/components/import/demo-loader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAttachableSources } from "@/app/import/attach-actions";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "匯入文章包" };
export const dynamic = "force-dynamic";

const MINIMAL = `{
  "source": { "title": "文章標題", "url": "https://example.gov.tw/article" },
  "facts": [
    {
      "statement": "一句一事的事實敘述。",
      "paragraph_id": "P-004",
      "paragraph_text": "這一段的完整原文，讓事實有東西可以對照。",
      "quote": "段落中支持這句話的片段"
    }
  ]
}`;

const FULL = `{
  "export_meta": { "human_review": "completed" },
  "source": { "title": "文章標題", "url": "https://example.gov.tw/article" },
  "document_chunks": [
    { "paragraph_id": "P-004", "position": 4,
      "heading_path": ["小節標題"], "text": "這一段的實際文字。" }
  ],
  "facts": [
    {
      "ref": "C001",
      "statement": "一句一事的事實敘述。",
      "subject": "主體", "predicate": "關係", "object": "客體",
      "knowledge_type": "物質",
      "risk_level": "中",
      "conditions": { "population": "孕婦" },
      "paragraph_id": "P-004",
      "quote": "段落中支持這句話的片段",
      "status": "核定",
      "review_note": "核定理由或 AI 審核意見"
    }
  ],
  "review_records": [
    { "candidate_fact_id": "C001", "action": "核定", "note": "人工核定" }
  ],
  "knowledge_facts": [
    { "ref": "F001", "candidate_fact_id": "C001", "tags": ["標籤"] }
  ]
}`;

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/import");

  const existing = await listAttachableSources().catch(() => []);

  return (
    <AppShell
      title="匯入文章包"
      description="把在對話或其他工具中整理好的一篇文章，連同段落、候選事實、審核紀錄與正式事實一次匯入。"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>原文 + 事實包（建議）</CardTitle>
            <CardDescription>
              原文用檔案、網址或貼上文字提供，系統解析成段落後，
              再用內容比對找出每一筆事實對應到哪一段。事實包因此不需要自帶原文。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SourceWithPack existing={existing} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>只有事實包（事實包自帶原文）</CardTitle>
            <CardDescription>
              事實包裡已經含有段落原文時用這個。匯入前會先驗證，驗證不會寫入任何資料。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ArticlePackImport />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>示範資料</CardTitle>
            <CardDescription>
              三篇自行撰寫的短文（氫氟酸、汞、蘇丹紅），每篇含 12 筆候選事實（6
              核定、2 待修正、2 駁回、2 待審核）與 3 份素材草稿。
              走的是與上面完全相同的匯入路徑。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DemoLoader />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>只有一個硬性要求</CardTitle>
            <CardDescription>
              每一筆事實都要找得到原文——原文可以另外上傳，也可以寫在事實包裡。
              其他欄位不合就自動補，補不了只跳過那一筆。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="font-medium text-red-900">事實必須對得到原文</p>
              <p className="mt-2 text-red-900">兩種寫法擇一：</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-red-900">
                <li>
                  在該筆事實加 <code>paragraph_text</code>
                </li>
                <li>
                  或在 <code>document_chunks</code> 提供該段落的 <code>text</code>
                </li>
              </ul>
              <p className="mt-2 text-xs text-red-800">
                兩者都沒有的事實只會跳過那一筆；整篇都沒有才會整篇跳過。
              </p>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="font-medium text-amber-900">引句對不上不會擋下匯入</p>
              <p className="mt-2 text-amber-900">
                引句缺漏、是佔位符或對不上原文時，系統會改用<b>整段原文</b>當依據，
                並把狀態強制設回「待審核」。
              </p>
              <p className="mt-2 text-xs text-amber-800">
                即使檔案寫 approved
                也不會變成正式事實——它會出現在候選事實頁等你確認。
                引句可用刪節號串接多段，例如「甲…乙」。
              </p>
            </div>

            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <p className="font-medium text-emerald-900">這些系統會自動處理</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-900">
                <li>
                  欄位別名：<code>facts</code>／<code>candidate_facts</code>、
                  <code>quote</code>／<code>source_quote</code>、中文欄位名都接受
                </li>
                <li>
                  列舉值：<code>核定</code>、<code>高風險</code>、<code>物質</code>
                  等中文直接寫；對不上就回落預設值
                </li>
                <li>
                  段落編號：<code>P-004</code>、<code>P004</code>、<code>4</code>{" "}
                  都會對上
                </li>
                <li>
                  <code>ref</code>、雜湊、字元位置、時間戳：不用給
                </li>
              </ul>
              <p className="mt-2 text-xs text-emerald-800">
                完整欄位對照見 <code>docs/ARTICLE-PACK.md</code>。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>格式範例</CardTitle>
            <CardDescription>
              上面是最小可用格式，下面是完整寫法。除了標題與事實敘述，其他欄位都可省略。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <a
                href="/examples/fact-pack-minimal.json"
                download="事實包範例-最小.json"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                下載最小範例
              </a>
              <a
                href="/examples/fact-pack-full.json"
                download="事實包範例-完整.json"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                下載完整範例
              </a>
              <span className="self-center text-xs text-slate-500">
                兩份範例都附了逐欄說明（底線開頭的欄位系統會忽略），可以直接改成自己的內容。
              </span>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">標為駁回的事實不會匯入</p>
              <p className="mt-1 text-xs">
                <code>status</code> 是 <code>駁回</code>／<code>rejected</code>{" "}
                的事實會被略過，匯入畫面會列出略過了哪幾筆。
                駁回代表這句話不成立，建成候選事實只會讓它躺在待審清單裡等著被誤放行。
                要保留紀錄請留在事實包檔案裡。
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-800">
                最小可用格式
              </p>
              <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
                {MINIMAL}
              </pre>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-800">完整寫法</p>
              <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
                {FULL}
              </pre>
            </div>
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
