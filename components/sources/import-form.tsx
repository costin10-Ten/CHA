"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  createTextSource,
  createUploadTicket,
  createUrlSource,
  finalizeUpload,
} from "@/app/sources/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { kickWorker } from "@/lib/jobs/client";
import { createClient } from "@/lib/supabase/client";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  SOURCES_BUCKET,
  isAllowedUpload,
  type ImportActionResult,
} from "@/lib/sources/schema";

type Mode = "text" | "url" | "file";

const MODE_LABEL: Record<Mode, string> = {
  text: "貼入文字",
  url: "輸入網址",
  file: "上傳檔案",
};

const initialState: ImportActionResult = { status: "idle" };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "處理中…" : label}
    </Button>
  );
}

/** 匯入成功後觸發 Edge Function 並重新整理列表。 */
function useAfterImport(state: ImportActionResult) {
  const router = useRouter();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (state.status !== "success" || handled.current === state.sourceId) return;
    handled.current = state.sourceId;
    void kickWorker().then(() => router.refresh());
    router.refresh();
  }, [state, router]);
}

function TextForm() {
  const [state, formAction] = useActionState(createTextSource, initialState);
  useAfterImport(state);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="text-title">標題（選填）</Label>
        <Input
          id="text-title"
          name="title"
          placeholder="例如：氫氟酸安全資料摘要"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="text-body">內容</Label>
        <Textarea
          id="text-body"
          name="text"
          required
          minLength={20}
          rows={10}
          placeholder="貼上要建立知識庫的原始文字。系統會保存原文、切成段落並標上段落編號，之後每一筆原子命題都能回溯到這裡。"
        />
      </div>
      <SubmitButton label="建立來源" />
      <FormMessage state={state} />
    </form>
  );
}

function UrlForm() {
  const [state, formAction] = useActionState(createUrlSource, initialState);
  useAfterImport(state);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="url-title">標題（選填）</Label>
        <Input id="url-title" name="title" placeholder="留空則自動從網頁標題取得" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="url-value">網址</Label>
        <Input
          id="url-value"
          name="url"
          type="url"
          required
          placeholder="https://example.com/article"
        />
        <p className="text-xs text-slate-500">
          只支援公開網址。系統會抓取頁面、清除導覽列與頁尾後保留內文段落。
        </p>
      </div>
      <SubmitButton label="抓取並建立來源" />
      <FormMessage state={state} />
    </form>
  );
}

function FileForm() {
  const router = useRouter();
  const [state, setState] = useState<ImportActionResult>(initialState);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    const title = (formData.get("title") as string) || undefined;

    if (!(file instanceof File) || file.size === 0) {
      setState({ status: "error", message: "請選擇檔案" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({ status: "error", message: "檔案超過 50 MB" });
      return;
    }
    if (!isAllowedUpload(file.name, file.type)) {
      setState({
        status: "error",
        message: `只支援 ${ALLOWED_UPLOAD_EXTENSIONS.join("、")}`,
      });
      return;
    }

    setBusy(true);
    setState(initialState);

    try {
      setProgress("建立上傳連結…");
      const ticket = await createUploadTicket({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        title,
      });

      if (!ticket.ok) {
        setState({ status: "error", message: ticket.message });
        return;
      }

      // 檔案直接從瀏覽器上傳到 Supabase Storage，不經過應用伺服器。
      setProgress("上傳檔案到 Supabase Storage…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(SOURCES_BUCKET)
        .uploadToSignedUrl(ticket.ticket.path, ticket.ticket.token, file, {
          upsert: true,
        });

      if (uploadError) {
        setState({ status: "error", message: `上傳失敗：${uploadError.message}` });
        return;
      }

      setProgress("建立解析工作…");
      const result = await finalizeUpload(ticket.ticket.sourceId, title);
      setState(result);

      if (result.status === "success") {
        form.reset();
        await kickWorker();
        router.refresh();
      }
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "上傳失敗",
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="file-title">標題（選填）</Label>
        <Input id="file-title" name="title" placeholder="留空則使用檔名" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="file-input">檔案</Label>
        <Input
          id="file-input"
          name="file"
          type="file"
          required
          accept=".txt,.md,.markdown,.html,.htm,.pdf,text/plain,text/markdown,text/html,application/pdf"
          className="h-auto py-2 file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-white"
        />
        <p className="text-xs text-slate-500">
          支援 .txt、.md、.html 與文字型 .pdf，上限 50 MB。檔案由瀏覽器直接上傳
          Supabase Storage。
        </p>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? (progress ?? "處理中…") : "上傳並建立來源"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

function FormMessage({ state }: { state: ImportActionResult }) {
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-600">
        {state.message}
      </p>
    );
  }
  if (state.status === "success") {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return null;
}

export function ImportForm() {
  const [mode, setMode] = useState<Mode>("text");

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="匯入方式"
        className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1"
      >
        {(Object.keys(MODE_LABEL) as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded px-2 py-1.5 text-sm font-medium transition-colors ${
              mode === value
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {MODE_LABEL[value]}
          </button>
        ))}
      </div>

      {mode === "text" && <TextForm />}
      {mode === "url" && <UrlForm />}
      {mode === "file" && <FileForm />}
    </div>
  );
}
