"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { askQuestion, type AskResult } from "@/app/ask/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AskForm({ defaultQuestion = "" }: { defaultQuestion?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState(defaultQuestion);
  const [result, setResult] = useState<AskResult>({ status: "idle" });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const outcome = await askQuestion(question);
      setResult(outcome);
      if (outcome.status === "success") {
        setQuestion("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        rows={3}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="例如：孕婦吃大型魚類要注意什麼？"
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || question.trim().length < 4}>
          {pending ? "查詢核定原子命題並作答中…" : "提問"}
        </Button>
        <p className="text-xs text-slate-500">
          回答只會使用檢索到的核定原子命題；沒有相關原子命題時會直接說明資料不足。
        </p>
      </div>

      {result.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {result.message}
        </p>
      )}
      {result.status === "success" && (
        <p role="status" className="text-sm text-emerald-700">
          {result.message}
        </p>
      )}
    </form>
  );
}
