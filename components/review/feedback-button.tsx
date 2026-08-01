"use client";

import { useState, useTransition } from "react";

import {
  reportExtractionIssue,
  type FeedbackResult,
} from "@/app/review/feedback-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_TYPE_LABEL } from "@/lib/facts/feedback-labels";

/** 「回報抽取問題」：把 AI 抽錯的原因記下來，用來改進提示詞。 */
export function FeedbackButton({ candidateFactId }: { candidateFactId: string }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("beyond_source");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<FeedbackResult>({ status: "idle" });

  function submit() {
    startTransition(async () => {
      const outcome = await reportExtractionIssue(
        candidateFactId,
        type,
        description,
      );
      setResult(outcome);
      if (outcome.status === "success") {
        setOpen(false);
        setDescription("");
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setOpen((current) => !current)}
      >
        回報抽取問題
      </Button>

      {result.status !== "idle" && !open && (
        <span
          role="status"
          className={`text-xs ${
            result.status === "error" ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {result.message}
        </span>
      )}

      {open && (
        <div className="w-full space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              問題類型
            </span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              disabled={pending}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              {Object.entries(FEEDBACK_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="具體說明哪裡抽錯了，例如：原文只說「部分研究顯示」，抽出來變成肯定句。"
            disabled={pending}
          />

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? "送出中…" : "送出回報"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              取消
            </Button>
            {result.status === "error" && (
              <span role="alert" className="text-xs text-red-600">
                {result.message}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
