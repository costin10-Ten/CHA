"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loadDemoData, type DemoResult } from "@/app/import/demo-actions";
import { Button } from "@/components/ui/button";

/** 一鍵載入三篇示範文章與素材，用來確認整條流程可用。 */
export function DemoLoader() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DemoResult>({ status: "idle" });

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const outcome = await loadDemoData();
            setResult(outcome);
            if (outcome.status === "success") router.refresh();
          })
        }
      >
        {pending ? "載入中…（會產製素材，需要幾秒）" : "載入示範資料"}
      </Button>

      {result.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {result.message}
        </p>
      )}

      {result.status === "success" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p role="status" className="text-sm text-emerald-900">
            {result.message}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
            {result.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
