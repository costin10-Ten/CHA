"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importCandidatePack, type ImportResult } from "@/app/export/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** 把外部 LLM 校正過的待選原子命題包貼回來。結果一律進入待審核。 */
export function PackImport() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [json, setJson] = useState("");
  const [result, setResult] = useState<ImportResult>({ status: "idle" });

  function handleImport() {
    startTransition(async () => {
      const outcome = await importCandidatePack(json);
      setResult(outcome);
      if (outcome.status === "success") {
        setJson("");
        router.refresh();
      }
    });
  }

  async function handleFile(file: File) {
    setJson(await file.text());
    setResult({ status: "idle" });
  }

  return (
    <div className="space-y-3">
      <input
        type="file"
        accept="application/json,.json"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
        className="block w-full text-sm text-slate-900 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-slate-900"
      />

      <Textarea
        rows={8}
        value={json}
        onChange={(event) => setJson(event.target.value)}
        placeholder='或直接貼上回填的 JSON，例如：{"pack_version":1,"facts":[{"id":"…","statement":"…","verdict":"revised","correction_reason":"…"}]}'
        disabled={pending}
        className="font-mono text-xs"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={handleImport}
          disabled={pending || json.trim().length === 0}
        >
          {pending ? "檢查並回填中…" : "匯入回填結果"}
        </Button>
        <p className="text-xs text-slate-500">
          回填內容會重新跑一次自動品質檢查，並維持在「待審核」，不會直接核定。
        </p>
      </div>

      {result.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {result.message}
        </p>
      )}

      {result.status === "success" && (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p role="status" className="text-sm text-emerald-800">
            {result.message}
          </p>
          {result.problems.length > 0 && (
            <details className="text-xs text-slate-700">
              <summary className="cursor-pointer">
                被拒絕或需要注意的 {result.problems.length} 筆
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
