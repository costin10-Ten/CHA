"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { importPkbPack, type PkbResult } from "@/app/pkb/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function PkbPackImport() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [json, setJson] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [trust, setTrust] = useState(false);
  const [result, setResult] = useState<PkbResult>({ status: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    const text = await file.text();
    setJson(text);
    setFilename(file.name);
    setResult({ status: "idle" });
  }

  function submit() {
    startTransition(async () => {
      const outcome = await importPkbPack(json, {
        filename: filename ?? undefined,
        trustPackApproval: trust,
      });
      setResult(outcome);
      if (outcome.status === "success") {
        setJson("");
        setFilename(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  const issues = result.status === "idle" ? [] : (result.issues ?? []);
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  return (
    <Card>
      <CardHeader>
        <CardTitle>上傳原子知識包</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            aria-label="選擇原子知識包檔案"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
            className="text-sm"
          />
          {filename && (
            <span className="text-xs text-slate-500">已讀取 {filename}</span>
          )}
        </div>

        <Textarea
          rows={10}
          value={json}
          onChange={(event) => setJson(event.target.value)}
          placeholder='也可以直接貼上 JSON，例如 {"source":{"title":"某篇文章"},"items":[{"statement":"一句知識。","source_type":"科普文章"}]}'
        />

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={trust}
            onChange={(event) => setTrust(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300"
          />
          <span>
            沿用檔案中標示「已同意」的結果
            <span className="ml-1 text-xs text-slate-500">
              （不勾的話全部以待同意匯入，逐筆看過再同意）
            </span>
          </span>
        </label>

        <Button disabled={pending || json.trim().length === 0} onClick={submit}>
          {pending ? "匯入中…" : "匯入"}
        </Button>

        {result.status === "error" && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <p role="alert" className="text-sm text-red-800">
              {result.message}
            </p>
            {errors.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-800">
                {errors.slice(0, 20).map((issue, index) => (
                  <li key={index}>
                    {issue.where}：{issue.message}
                    {issue.hint ? `（${issue.hint}）` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {result.status === "success" && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p role="status" className="text-sm text-emerald-900">
              {result.message}
            </p>
            {errors.length > 0 && (
              <details className="mt-2 text-xs text-slate-700">
                <summary className="cursor-pointer">
                  被跳過的 {errors.length} 筆
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {errors.map((issue, index) => (
                    <li key={index}>
                      {issue.where}：{issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {warnings.length > 0 && (
              <details className="mt-2 text-xs text-slate-700">
                <summary className="cursor-pointer">
                  系統自動處理了 {warnings.length} 項
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {warnings.map((issue, index) => (
                    <li key={index}>
                      {issue.where}：{issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
