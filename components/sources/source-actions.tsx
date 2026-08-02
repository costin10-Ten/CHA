"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteSource, extractFacts, reparseSource } from "@/app/sources/actions";
import { Button } from "@/components/ui/button";
import { kickWorker } from "@/lib/jobs/client";

export function SourceActions({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleReparse() {
    startTransition(async () => {
      const result = await reparseSource(sourceId);
      setMessage(result.status === "idle" ? null : result.message);
      if (result.status === "success") {
        await kickWorker();
        router.refresh();
      }
    });
  }

  function handleExtract() {
    startTransition(async () => {
      const result = await extractFacts(sourceId);
      setMessage(result.status === "idle" ? null : result.message);
      if (result.status === "success") {
        await kickWorker();
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!window.confirm("確定刪除這個來源？其版本與段落會一併移除，無法復原。")) {
      return;
    }
    startTransition(async () => {
      const result = await deleteSource(sourceId);
      if (result.status === "success") {
        router.push("/sources");
        router.refresh();
      } else if (result.status === "error") {
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleReparse}
        disabled={pending}
      >
        {pending ? "處理中…" : "重新解析"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleExtract}
        disabled={pending}
      >
        抽取候選原子命題
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={handleDelete}
        disabled={pending}
      >
        刪除
      </Button>
      {message && <span className="text-xs text-slate-600">{message}</span>}
    </div>
  );
}
