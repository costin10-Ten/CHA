"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { verifyAnswerSession, type VerifyResult } from "@/app/verify/actions";
import { Button } from "@/components/ui/button";
import type { AnswerSentenceRow, SentenceVerdict } from "@/lib/supabase/types";

export const VERDICT_LABEL: Record<SentenceVerdict, string> = {
  supported: "綠：直接支持",
  partial: "黃：部分支持或需確認",
  unsupported: "紅：無證據支持",
};

const VERDICT_CLASS: Record<SentenceVerdict, string> = {
  supported: "border-l-4 border-emerald-500 bg-emerald-50",
  partial: "border-l-4 border-amber-500 bg-amber-50",
  unsupported: "border-l-4 border-red-500 bg-red-50",
};

const VERDICT_BADGE: Record<SentenceVerdict, string> = {
  supported: "bg-emerald-600 text-white",
  partial: "bg-amber-500 text-white",
  unsupported: "bg-red-600 text-white",
};

export function VerificationPanel({
  sessionId,
  sentences,
  publishable,
  publishedAnswer,
  verifiedAt,
}: {
  sessionId: string;
  sentences: AnswerSentenceRow[];
  publishable: boolean;
  publishedAnswer: string | null;
  verifiedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<VerifyResult>({ status: "idle" });

  function handleVerify() {
    startTransition(async () => {
      const outcome = await verifyAnswerSession(sessionId);
      setResult(outcome);
      if (outcome.status === "success") router.refresh();
    });
  }

  const blocked = sentences.some((item) => item.verdict === "unsupported");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={handleVerify} disabled={pending}>
          {pending ? "驗證中…" : verifiedAt ? "重新驗證" : "執行逐句驗證"}
        </Button>
        {result.status !== "idle" && (
          <span
            role="status"
            className={`text-sm ${
              result.status === "error" ? "text-red-600" : "text-slate-700"
            }`}
          >
            {result.message}
          </span>
        )}
      </div>

      {blocked && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          有句子沒有核定原子命題支持，這份回答不可作為發布稿。
          請修正或刪除紅色句子，或先補足相關的核定原子命題。
        </p>
      )}

      <ol className="space-y-2">
        {sentences.map((item) => (
          <li
            key={item.id}
            className={`rounded p-3 ${
              item.verdict
                ? VERDICT_CLASS[item.verdict]
                : "border-l-4 border-slate-300 bg-slate-50"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  item.verdict
                    ? VERDICT_BADGE[item.verdict]
                    : "bg-slate-400 text-white"
                }`}
              >
                {item.verdict ? VERDICT_LABEL[item.verdict] : "尚未驗證"}
              </span>
              {item.supporting_refs.length > 0 && (
                <span className="font-mono text-xs text-slate-600">
                  {item.supporting_refs.join("、")}
                </span>
              )}
              <span className="ml-auto text-xs text-slate-500">
                相似度 {(item.similarity * 100).toFixed(0)}%
              </span>
            </div>

            <p className="mt-1.5 text-sm text-slate-900">{item.sentence}</p>

            {item.note && (
              <p className="mt-1 text-xs text-slate-600">判定依據：{item.note}</p>
            )}
          </li>
        ))}
      </ol>

      <div className="rounded border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-900">最終發布稿</p>
        {publishable && publishedAnswer ? (
          <>
            <p className="mt-1 text-xs text-emerald-700">
              沒有紅色句子，這份內容可以往下使用。
            </p>
            <pre className="mt-2 text-sm whitespace-pre-wrap text-slate-800">
              {publishedAnswer}
            </pre>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            {verifiedAt
              ? "因為存在紅色句子，系統不產生發布稿。"
              : "尚未驗證，先執行逐句驗證。"}
          </p>
        )}
      </div>
    </div>
  );
}
