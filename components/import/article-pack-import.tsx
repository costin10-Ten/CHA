"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  importArticlePack,
  validatePack,
  type ImportPackResult,
  type ValidateResult,
} from "@/app/import/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** 文章包匯入：先驗證再匯入，驗證沒過就不讓匯入。 */
export function ArticlePackImport() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [trust, setTrust] = useState(false);
  const [check, setCheck] = useState<ValidateResult | null>(null);
  const [result, setResult] = useState<ImportPackResult>({ status: "idle" });

  function reset() {
    setCheck(null);
    setResult({ status: "idle" });
  }

  async function handleFile(file: File) {
    setJson(await file.text());
    setFileName(file.name);
    reset();
  }

  function handleValidate() {
    startTransition(async () => {
      const outcome = await validatePack(json);
      setCheck(outcome);
      setResult({ status: "idle" });
      if (outcome.humanReview === "completed") setTrust(true);
    });
  }

  function handleImport() {
    startTransition(async () => {
      const outcome = await importArticlePack(json, { trustHumanReview: trust });
      setResult(outcome);
      if (outcome.status === "success") {
        setJson("");
        setFileName(null);
        setCheck(null);
        router.refresh();
      }
    });
  }

  const errors = check?.issues.filter((issue) => issue.level === "error") ?? [];
  const warnings = check?.issues.filter((issue) => issue.level === "warning") ?? [];

  return (
    <div className="space-y-4">
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
        rows={6}
        value={json}
        onChange={(event) => {
          setJson(event.target.value);
          reset();
        }}
        placeholder="或直接貼上文章包 JSON"
        disabled={pending}
        className="font-mono text-xs"
      />

      {fileName && <p className="text-xs text-slate-500">已讀取檔案：{fileName}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={handleValidate}
          disabled={pending || json.trim().length === 0}
        >
          {pending ? "檢查中…" : "先驗證"}
        </Button>

        <Button onClick={handleImport} disabled={pending || !check?.ok}>
          匯入
        </Button>

        {!check && (
          <span className="text-xs text-slate-500">驗證通過後才能匯入。</span>
        )}
      </div>

      {check && (
        <div className="space-y-3">
          <div
            className={`rounded-md border p-3 text-sm ${
              check.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            <p className="font-medium">
              {check.ok
                ? `驗證通過：${check.title ?? "未命名文章"}`
                : `驗證未通過，有 ${errors.length} 個必須修正的問題`}
            </p>
            <p className="mt-1 text-xs">
              {check.summary.chunks} 段原文．{check.summary.candidates} 筆候選事實（
              已核定 {check.summary.approved}、已駁回 {check.summary.rejected}）．
              {check.summary.knowledgeFacts} 筆正式事實．{check.summary.reviews}{" "}
              筆審核紀錄
            </p>
          </div>

          {check.ok && (
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
              <input
                type="checkbox"
                checked={trust}
                onChange={(event) => setTrust(event.target.checked)}
                disabled={pending}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="font-medium text-slate-900">
                  沿用檔案中的人工核定結果
                </span>
                <span className="mt-1 block text-xs text-slate-600">
                  勾選後，已核定的候選事實會直接寫入正式事實庫；不勾選則全部以
                  「待審核」匯入，由你在系統裡逐筆核定。
                  {check.humanReview === "completed" &&
                    "（這個檔案標示人工審核已完成，已自動勾選）"}
                </span>
              </span>
            </label>
          )}

          {errors.length > 0 && (
            <ul className="space-y-2">
              {errors.slice(0, 20).map((issue, index) => (
                <li
                  key={index}
                  className="rounded border border-red-200 bg-white p-2 text-xs"
                >
                  <p className="font-mono text-slate-500">{issue.where}</p>
                  <p className="text-red-800">{issue.message}</p>
                  {issue.hint && <p className="text-slate-600">{issue.hint}</p>}
                </li>
              ))}
              {errors.length > 20 && (
                <li className="text-xs text-slate-500">
                  （另有 {errors.length - 20} 個同類問題未列出）
                </li>
              )}
            </ul>
          )}

          {warnings.length > 0 && (
            <details className="text-xs text-slate-700">
              <summary className="cursor-pointer">
                {warnings.length} 個提醒（不影響匯入）
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {warnings.map((issue, index) => (
                  <li key={index}>
                    <span className="font-mono text-slate-500">{issue.where}</span>
                    ：{issue.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {result.status === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p role="alert" className="text-sm text-red-800">
            {result.message}
          </p>
          {result.issues && result.issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-800">
              {result.issues.slice(0, 10).map((issue, index) => (
                <li key={index}>
                  {issue.where}：{issue.message}
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
          {result.problems.length > 0 && (
            <details className="mt-2 text-xs text-slate-700">
              <summary className="cursor-pointer">
                {result.problems.length} 個提醒
              </summary>
              <ul className="mt-1 list-disc space-y-1 pl-5">
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
