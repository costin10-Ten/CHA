"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { backfillPkbEmbeddings, type PkbResult } from "@/app/pkb/actions";
import { Button } from "@/components/ui/button";

/** 補齊向量：只做缺的那些，不重建整個索引。 */
export function PkbEmbedButton({ pending: pendingCount }: { pending: number }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [result, setResult] = useState<PkbResult>({ status: "idle" });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || pendingCount === 0}
        onClick={() =>
          startTransition(async () => {
            const outcome = await backfillPkbEmbeddings();
            setResult(outcome);
            if (outcome.status === "success") router.refresh();
          })
        }
      >
        {busy
          ? "產生中…"
          : pendingCount === 0
            ? "向量已是最新"
            : `補齊 ${pendingCount} 筆向量`}
      </Button>
      {result.status !== "idle" && (
        <span
          role="status"
          className={`text-xs ${
            result.status === "error" ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
