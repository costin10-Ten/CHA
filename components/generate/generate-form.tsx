"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { generateDraft, type GenerateResult } from "@/app/generate/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUDIENCE_OPTIONS, TONE_OPTIONS } from "@/lib/generate/labels";

export interface DraftTypeOption {
  value: string;
  label: string;
  lengthHint: string;
}

export function GenerateForm({ types }: { types: DraftTypeOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftType, setDraftType] = useState(types[0]?.value ?? "faq");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState(AUDIENCE_OPTIONS[0]);
  const [tone, setTone] = useState(TONE_OPTIONS[0]);
  const [result, setResult] = useState<GenerateResult>({ status: "idle" });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const outcome = await generateDraft({ draftType, topic, audience, tone });
      setResult(outcome);
      if (outcome.status === "success") {
        router.push(`/generate/${outcome.draftId}`);
      }
    });
  }

  const selected = types.find((type) => type.value === draftType);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            素材類型
          </span>
          <select
            value={draftType}
            onChange={(event) => setDraftType(event.target.value)}
            disabled={pending}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
          >
            {types.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            主題
          </span>
          <Input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="例如：孕婦攝取大型魚類的甲基汞風險"
            disabled={pending}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            目標受眾
          </span>
          <select
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            disabled={pending}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            語氣
          </span>
          <select
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            disabled={pending}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
          >
            {TONE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || topic.trim().length < 2}>
          {pending ? "檢索核定事實並產製中…" : "產生草稿"}
        </Button>
        {selected && (
          <span className="text-xs text-slate-500">
            建議篇幅：{selected.lengthHint}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">
        產製只會使用檢索到的核定事實，產出後立刻逐句驗證；
        只要有一句沒有事實支持就會標記為阻擋，不能定稿。
      </p>

      {result.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {result.message}
        </p>
      )}
    </form>
  );
}
