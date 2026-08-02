"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { attachFactPack, type AttachResult } from "@/app/import/attach-actions";
import {
  createTextSource,
  createUploadTicket,
  createUrlSource,
  finalizeUpload,
} from "@/app/sources/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { kickWorker } from "@/lib/jobs/client";
import { createClient } from "@/lib/supabase/client";
import { SOURCES_BUCKET } from "@/lib/sources/schema";

type SourceMode = "file" | "url" | "text";
type Phase = "idle" | "creating" | "parsing" | "attaching" | "done" | "failed";

const MODE_LABEL: Record<SourceMode, string> = {
  file: "上傳檔案",
  url: "輸入網址",
  text: "貼上文字",
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;

/**
 * 原文 + 原子命題包一次上傳。
 *
 * 原文走的是既有的來源匯入流程（檔案直傳 Storage、網址由 worker 抓取），
 * 解析完成後再把原子命題包附加上去，由系統用內容比對找出每一筆原子命題對應的段落。
 * 原子命題包因此完全不需要自帶原文。
 */
export function SourceWithPack({ existing }: { existing: SourceOptionView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<SourceMode>("file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [textBody, setTextBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [existingId, setExistingId] = useState("");

  const [json, setJson] = useState("");
  const [trust, setTrust] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<AttachResult>({ status: "idle" });

  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  async function readPackFile(picked: File) {
    setJson(await picked.text());
  }

  /** 等 worker 把來源解析成段落。 */
  async function waitForParse(sourceId: string): Promise<boolean> {
    const supabase = createClient();
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline && !cancelled.current) {
      const { data } = await supabase
        .from("sources")
        .select("status, last_error")
        .eq("id", sourceId)
        .maybeSingle();

      if (data?.status === "ready") return true;
      if (data?.status === "failed") {
        setProgress(`原文解析失敗：${data.last_error ?? "未知原因"}`);
        return false;
      }

      setProgress("原文解析中…（大型 PDF 可能需要一分鐘）");
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    setProgress("等待解析逾時。原文可能仍在處理，可稍後用「附加到既有來源」完成。");
    return false;
  }

  /** 建立來源並回傳 id。 */
  async function createSource(): Promise<string | null> {
    if (mode === "url") {
      const form = new FormData();
      form.set("url", url);
      if (title) form.set("title", title);

      const outcome = await createUrlSource({ status: "idle" }, form);
      if (outcome.status !== "success" || !outcome.sourceId) {
        setProgress(outcome.status === "error" ? outcome.message : "建立來源失敗");
        return null;
      }
      return outcome.sourceId;
    }

    if (mode === "text") {
      const form = new FormData();
      form.set("text", textBody);
      if (title) form.set("title", title);

      const outcome = await createTextSource({ status: "idle" }, form);
      if (outcome.status !== "success" || !outcome.sourceId) {
        setProgress(outcome.status === "error" ? outcome.message : "建立來源失敗");
        return null;
      }
      return outcome.sourceId;
    }

    if (!file) {
      setProgress("請選擇原文檔案");
      return null;
    }

    // 檔案不經過應用伺服器：先拿 signed URL，再由瀏覽器直傳 Storage。
    const ticket = await createUploadTicket({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      title: title || undefined,
    });

    if (!ticket.ok) {
      setProgress(ticket.message);
      return null;
    }

    const supabase = createClient();
    const { error } = await supabase.storage
      .from(SOURCES_BUCKET)
      .uploadToSignedUrl(ticket.ticket.path, ticket.ticket.token, file);

    if (error) {
      setProgress(`上傳失敗：${error.message}`);
      return null;
    }

    const finalized = await finalizeUpload(
      ticket.ticket.sourceId,
      title || undefined,
    );
    if (finalized.status !== "success") {
      setProgress(
        finalized.status === "error" ? finalized.message : "上傳後處理失敗",
      );
      return null;
    }

    return ticket.ticket.sourceId;
  }

  function run() {
    cancelled.current = false;
    setResult({ status: "idle" });

    startTransition(async () => {
      let sourceId = existingId;

      if (!sourceId) {
        setPhase("creating");
        setProgress("建立來源中…");

        const created = await createSource();
        if (!created) {
          setPhase("failed");
          return;
        }
        sourceId = created;

        setPhase("parsing");
        setProgress("已排入解析工作，正在觸發背景處理…");
        await kickWorker();

        const ready = await waitForParse(sourceId);
        if (!ready) {
          setPhase("failed");
          return;
        }
      }

      setPhase("attaching");
      setProgress("比對原子命題與原文段落中…");

      const outcome = await attachFactPack(sourceId, json, {
        trustHumanReview: trust,
      });

      setResult(outcome);
      setPhase(outcome.status === "success" ? "done" : "failed");

      if (outcome.status === "success") {
        setJson("");
        setFile(null);
        setTextBody("");
        setUrl("");
        router.refresh();
      }
    });
  }

  const busy = pending || phase === "parsing" || phase === "attaching";
  const canRun =
    json.trim().length > 0 &&
    (existingId !== "" ||
      (mode === "file" && file !== null) ||
      (mode === "url" && url.trim().length > 0) ||
      (mode === "text" && textBody.trim().length > 50));

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <p className="text-sm font-medium text-slate-900">1. 原文</p>

        {existing.length > 0 && (
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              附加到已經匯入過的來源（選了就不用再上傳原文）
            </span>
            <select
              value={existingId}
              onChange={(event) => setExistingId(event.target.value)}
              disabled={busy}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 sm:max-w-md"
            >
              <option value="">（上傳新的原文）</option>
              {existing.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}（{source.chunkCount} 段）
                </option>
              ))}
            </select>
          </label>
        )}

        {!existingId && (
          <>
            <div className="flex flex-wrap gap-2">
              {(["file", "url", "text"] as SourceMode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  disabled={busy}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    mode === value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {MODE_LABEL[value]}
                </button>
              ))}
            </div>

            {mode === "file" && (
              <div>
                <input
                  type="file"
                  accept=".txt,.md,.html,.htm,.pdf"
                  disabled={busy}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-900 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-slate-900"
                />
                <p className="mt-1 text-xs text-slate-500">
                  支援 .txt、.md、.html 與文字型
                  .pdf（掃描檔沒有文字層，無法解析）。 檔案由瀏覽器直傳
                  Storage，不經過應用伺服器。
                </p>
              </div>
            )}

            {mode === "url" && (
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.gov.tw/article"
                disabled={busy}
              />
            )}

            {mode === "text" && (
              <Textarea
                rows={6}
                value={textBody}
                onChange={(event) => setTextBody(event.target.value)}
                placeholder="貼上文章全文（至少 50 字）"
                disabled={busy}
              />
            )}

            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="標題（可留空，由系統從原文判斷）"
              disabled={busy}
            />
          </>
        )}
      </section>

      <section className="space-y-3 border-t border-slate-100 pt-4">
        <p className="text-sm font-medium text-slate-900">2. 原子命題包</p>

        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) void readPackFile(picked);
          }}
          className="block w-full text-sm text-slate-900 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-slate-900"
        />

        <Textarea
          rows={5}
          value={json}
          onChange={(event) => setJson(event.target.value)}
          placeholder="或直接貼上原子命題包 JSON。這條路徑不需要原子命題包自帶原文，只要有原子命題敘述。"
          disabled={busy}
          className="font-mono text-xs"
        />

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={trust}
            onChange={(event) => setTrust(event.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="font-medium text-slate-900">
              沿用檔案中的人工核定結果
            </span>
            <span className="mt-1 block text-xs text-slate-600">
              只有「引句直接命中原文」的原子命題才會沿用；
              由系統比對出段落的一律回到待審核，因為引句是系統推測的。
            </span>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <Button onClick={run} disabled={busy || !canRun}>
          {busy
            ? "處理中…"
            : existingId
              ? "附加原子命題包"
              : "上傳原文並附加原子命題包"}
        </Button>
        {progress && <span className="text-xs text-slate-600">{progress}</span>}
      </div>

      {result.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {result.message}
        </p>
      )}

      {result.status === "success" && (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p role="status" className="text-sm text-emerald-900">
            {result.message}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
            <li>引句直接命中原文：{result.matched.byQuote} 筆（引句照用）</li>
            <li>
              以敘述內容比對出段落：{result.matched.byStatement}{" "}
              筆（引句由系統定位）
            </li>
            <li>依段落編號對應：{result.matched.byParagraphId} 筆</li>
            <li>找不到對應段落：{result.matched.unmatched} 筆</li>
            {result.matched.ambiguous > 0 && (
              <li>其中 {result.matched.ambiguous} 筆有多段分數接近，請特別確認</li>
            )}
          </ul>
          {result.problems.length > 0 && (
            <details className="text-xs text-slate-700">
              <summary className="cursor-pointer">
                {result.problems.length} 項需要注意
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

export interface SourceOptionView {
  id: string;
  title: string;
  chunkCount: number;
}
