"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  promoteAllApproved,
  rebuildMissingEmbeddings,
  reviseFact,
  setFactStatus,
  type KnowledgeResult,
} from "@/app/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { kickWorker } from "@/lib/jobs/client";
import type { KnowledgeFactRow } from "@/lib/supabase/types";

function useRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<KnowledgeResult>({ status: "idle" });

  function run(work: () => Promise<KnowledgeResult>, kick = false) {
    startTransition(async () => {
      const outcome = await work();
      setResult(outcome);
      if (outcome.status === "success") {
        if (kick) await kickWorker();
        router.refresh();
      }
    });
  }

  return { pending, result, run };
}

function ResultMessage({ result }: { result: KnowledgeResult }) {
  if (result.status === "idle") return null;
  return (
    <p
      role="status"
      className={`text-sm ${
        result.status === "error" ? "text-red-600" : "text-emerald-700"
      }`}
    >
      {result.message}
    </p>
  );
}

/** 清單頁的操作列：批次寫入正式原子命題、補齊向量。 */
export function KnowledgeToolbar({ pendingCount }: { pendingCount: number }) {
  const { pending, result, run } = useRunner();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending || pendingCount === 0}
        onClick={() => run(promoteAllApproved, true)}
      >
        寫入已核定的 {pendingCount} 筆
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(rebuildMissingEmbeddings, true)}
      >
        補齊缺少的向量
      </Button>
      <ResultMessage result={result} />
    </div>
  );
}

/** 單筆正式原子命題的修改與停用。 */
export function FactRevisionPanel({ fact }: { fact: KnowledgeFactRow }) {
  const { pending, result, run } = useRunner();
  const [statement, setStatement] = useState(fact.statement);
  const [note, setNote] = useState("");

  const superseded = fact.status === "superseded";

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="fact-statement">原子命題敘述</Label>
        <Textarea
          id="fact-statement"
          rows={3}
          value={statement}
          disabled={superseded}
          onChange={(event) => setStatement(event.target.value)}
        />
        <p className="text-xs text-slate-500">
          儲存後會建立新版本，舊版標記為已取代並保留；
          只有這一筆的向量會重做，其他原子命題的索引不受影響。
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fact-note">修改說明（選填）</Label>
        <Input
          id="fact-note"
          value={note}
          disabled={superseded}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || superseded || statement.trim() === fact.statement}
          onClick={() =>
            run(
              () =>
                reviseFact(fact.id, statement, { note: note.trim() || undefined }),
              true,
            )
          }
        >
          建立新版本
        </Button>

        {fact.status === "active" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setFactStatus(fact.id, "inactive"))}
          >
            停用
          </Button>
        )}

        {fact.status === "inactive" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setFactStatus(fact.id, "active"), true)}
          >
            恢復為現行
          </Button>
        )}
      </div>

      <ResultMessage result={result} />
    </div>
  );
}
