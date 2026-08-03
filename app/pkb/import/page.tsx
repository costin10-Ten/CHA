import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PkbPackImport } from "@/components/pkb/pack-import";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/supabase/server";
import { PKB_SOURCE_TYPES } from "@/lib/supabase/types";
import { PKB_SOURCE_TYPE_LABEL } from "@shared/pkb-pack.ts";

export const metadata: Metadata = { title: "匯入原子知識" };
export const dynamic = "force-dynamic";

const MINIMAL = `{
  "source": { "title": "環境荷爾蒙怎麼讓我內分泌失調的？" },
  "items": [
    { "statement": "一句一事的原子知識。", "source_type": "科普文章" }
  ]
}`;

const FULL = `{
  "source": {
    "title": "化學物質登錄辦法",
    "url": "https://cha.gov.tw/law",
    "source_type": "國內法規"
  },
  "items": [
    {
      "ref": "K001",
      "statement": "化學物質登錄制度由環境部化學物質管理署主管。",
      "source_type": "國內法規",
      "source_note": "第 3 條",
      "subject": "化學物質登錄制度",
      "predicate": "主管機關",
      "object": "環境部化學物質管理署",
      "tags": ["登錄", "權責"],
      "status": "同意"
    }
  ]
}`;

export default async function PkbImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/pkb/import");

  return (
    <AppShell
      title="匯入原子知識"
      description="在其他 LLM 整理好的原子知識包，貼上或上傳即可。系統不做 AI 審核，只檢查每一筆說不說得出來源。"
    >
      <div className="space-y-6">
        <PkbPackImport />

        <Card>
          <CardHeader>
            <CardTitle>只有兩個必填欄位</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code>statement</code>：一句一事的知識敘述
              </li>
              <li>
                <code>source_label</code>：來源名稱。寫在整包的{" "}
                <code>source.title</code> 就可以讓每一筆共用
              </li>
            </ul>
            <p className="text-xs text-slate-500">
              這一版**不比對原文**，來源名稱是唯一能說明「這句話從哪來」的欄位，
              所以是硬性要求。其餘欄位都可省略。
            </p>
            <p className="text-xs text-slate-500">
              標示駁回的項目不會匯入；已經收過的同一句話會自動略過。 CHA
              的文章包可以直接沿用——<code>facts</code> 會被讀成清單，
              <code>proposition_types</code> 併進標籤。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>九類來源分類（單選）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              {PKB_SOURCE_TYPES.map((value) => (
                <div key={value} className="flex min-w-0 gap-2">
                  <code className="shrink-0 text-xs text-slate-500">{value}</code>
                  <span className="min-w-0">
                    {PKB_SOURCE_TYPE_LABEL[value]}
                    {(value === "mock_question" || value === "formal_idea") && (
                      <span className="ml-1 text-xs text-amber-700">
                        （自製內容）
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              中文直接寫沒問題（「科普文章」「國內法規」…），認不得的會退到「其他」並提醒，不會擋下匯入。
              分不進這九類時就填其他，並在來源名稱寫清楚實際出處。
            </p>
            <p className="text-xs text-amber-700">
              模擬題與正式發想點會標記為自製內容。匯出給其他 LLM 時會明確標示，
              避免自己的發想被當成既有事實引用回來。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>格式範例</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
              預設全部以待同意匯入，到
              <Link href="/pkb" className="mx-1 underline">
                知識庫
              </Link>
              逐筆或批次同意。同意之後才會建立圖譜、進入搜尋與匯出。
            </p>
            <p className="text-xs text-slate-500">
              同意後記得到
              <Link href="/pkb/search" className="mx-1 underline">
                搜尋
              </Link>
              補齊向量，語意搜尋才找得到新知識。
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
