"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteDraft,
  finalizeDraft,
  updateDraftBody,
  type GenerateResult,
} from "@/app/generate/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface DraftSentence {
  sentence: string;
  verdict: "supported" | "partial" | "unsupported";
  supportingRefs: string[];
  reasons: string[];
  similarity: number;
  /** 體裁結構（小標、題號、秒數），不是原子命題主張。 */
  structural: boolean;
}

const VERDICT_CLASS: Record<DraftSentence["verdict"], string> = {
  supported: "border-l-4 border-emerald-500 bg-emerald-50",
  partial: "border-l-4 border-amber-500 bg-amber-50",
  unsupported: "border-l-4 border-red-500 bg-red-50",
};

const VERDICT_LABEL: Record<DraftSentence["verdict"], string> = {
  supported: "綠：有原子命題支持",
  partial: "黃：部分支持或需確認",
  unsupported: "紅：無原子命題支持",
};

export function DraftEditor({
  draftId,
  body,
  status,
  publishable,
  sentences,
}: {
  draftId: string;
  body: string;
  status: string;
  publishable: boolean;
  sentences: DraftSentence[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  const [result, setResult] = useState<GenerateResult>({ status: "idle" });

  function run(work: () => Promise<GenerateResult>, after?: () => void) {
    startTransition(async () => {
      const outcome = await work();
      setResult(outcome);
      if (outcome.status === "success") {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            修改內容
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={pending || text.trim().length === 0}
              onClick={() =>
                run(
                  () => updateDraftBody(draftId, text),
                  () => setEditing(false),
                )
              }
            >
              {pending ? "儲存並重新驗證中…" : "儲存並重新驗證"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setText(body);
                setEditing(false);
              }}
            >
              取消
            </Button>
          </>
        )}

        <Button
          size="sm"
          variant="outline"
          disabled={pending || !publishable || status === "final"}
          onClick={() => run(() => finalizeDraft(draftId))}
        >
          {status === "final" ? "已定稿" : "標記為定稿"}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => navigator.clipboard?.writeText(body)}
        >
          複製全文
        </Button>

        <Button
          size="sm"
          variant="destructive"
          className="ml-auto"
          disabled={pending}
          onClick={() =>
            run(
              () => deleteDraft(draftId),
              () => router.push("/generate"),
            )
          }
        >
          刪除
        </Button>
      </div>

      {!publishable && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          這份草稿有沒有原子命題支持的句子，無法定稿。請修掉紅色句子，或先補上對應的核定原子命題。
        </p>
      )}

      {result.status !== "idle" && (
        <p
          role="status"
          className={`text-sm ${
            result.status === "error" ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {result.message}
        </p>
      )}

      {editing ? (
        <Textarea
          rows={20}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={pending}
          className="font-sans text-sm"
        />
      ) : sentences.length === 0 ? (
        <p className="text-sm whitespace-pre-wrap text-slate-800">{body}</p>
      ) : (
        <ul className="space-y-2">
          {sentences.map((item, index) => (
            <li
              key={index}
              className={`rounded p-3 ${
                item.structural
                  ? "border-l-4 border-slate-300 bg-slate-50"
                  : VERDICT_CLASS[item.verdict]
              }`}
            >
              <p className="text-sm whitespace-pre-wrap text-slate-900">
                {item.sentence}
              </p>
              {item.structural ? (
                <p className="mt-1 text-xs text-slate-500">
                  體裁結構，不計入驗證統計
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-600">
                  {VERDICT_LABEL[item.verdict]}
                  {item.supportingRefs.length > 0 && (
                    <span className="ml-2 font-mono">
                      {item.supportingRefs.join("、")}
                    </span>
                  )}
                  <span className="ml-2">相似度 {item.similarity.toFixed(2)}</span>
                </p>
              )}
              {!item.structural && item.reasons.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                  {item.reasons.map((reason, reasonIndex) => (
                    <li key={reasonIndex}>{reason}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
