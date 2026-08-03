"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  approvePkbItem,
  batchPkbAction,
  restorePkbItem,
  trashPkbItem,
  type PkbResult,
} from "@/app/pkb/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PKB_SOURCE_TYPE_LABEL } from "@shared/pkb-pack.ts";
import type { PkbItemRow } from "@/lib/supabase/types";

const STATUS_LABEL = {
  draft: "待同意",
  active: "已同意",
  trashed: "在垃圾桶",
} as const;

const STATUS_CLASS = {
  draft: "bg-blue-100 text-blue-800",
  active: "bg-emerald-100 text-emerald-800",
  trashed: "bg-slate-100 text-slate-600",
} as const;

export function PkbItemList({
  items,
  mode = "review",
}: {
  items: PkbItemRow[];
  mode?: "review" | "trash";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<PkbResult>({ status: "idle" });

  // 批次只作用於待同意的：一次幾十筆的動作不該有能力翻掉已經做過的判斷。
  const selectable = items.filter((item) => item.status === "draft");
  const decided = items.length - selectable.length;

  function run(work: () => Promise<PkbResult>, clear = true) {
    startTransition(async () => {
      const outcome = await work();
      setResult(outcome);
      if (outcome.status === "success") {
        if (clear) setSelected(new Set());
        router.refresh();
      }
    });
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ids = [...selected];

  return (
    <div className="space-y-4">
      {mode === "review" && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 pt-6">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                aria-label="全選待同意"
                checked={
                  selectable.length > 0 && selected.size === selectable.length
                }
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(selectable.map((item) => item.id))
                      : new Set(),
                  )
                }
                disabled={pending || selectable.length === 0}
                className="h-4 w-4 rounded border-slate-300"
              />
              全選待同意
            </label>

            <span className="text-sm text-slate-600">
              已選取 {selected.size} 筆（可批次操作 {selectable.length} 筆
              {decided > 0 ? `，已同意 ${decided} 筆不列入` : ""}）
            </span>

            <Button
              size="sm"
              disabled={pending || selected.size === 0}
              onClick={() => run(() => batchPkbAction(ids, "approve"))}
            >
              批次同意
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || selected.size === 0}
              onClick={() => run(() => batchPkbAction(ids, "trash"))}
            >
              批次丟垃圾桶
            </Button>

            {result.status !== "idle" && (
              <span
                role="status"
                className={`text-sm ${
                  result.status === "error" ? "text-red-600" : "text-emerald-700"
                }`}
              >
                {result.message}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-500">
              {mode === "trash"
                ? "垃圾桶是空的。"
                : "還沒有原子知識。到「匯入」上傳一份原子知識包。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    {mode === "review" && (
                      <input
                        type="checkbox"
                        aria-label={`選取：${item.statement}`}
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                        disabled={item.status !== "draft"}
                        title={
                          item.status === "draft"
                            ? undefined
                            : "已同意的請用下方按鈕單筆處理"
                        }
                        className="h-4 w-4 rounded border-slate-300 disabled:opacity-40"
                      />
                    )}
                    <Badge className={STATUS_CLASS[item.status]}>
                      {STATUS_LABEL[item.status]}
                    </Badge>
                    <Badge className="bg-slate-100 text-slate-700">
                      {PKB_SOURCE_TYPE_LABEL[item.source_type]}
                    </Badge>
                    {item.is_self_authored && (
                      <Badge className="bg-amber-100 text-amber-800">
                        自製內容
                      </Badge>
                    )}
                    {item.tags.map((tag) => (
                      <Badge key={tag} className="bg-sky-50 text-sky-700">
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <p className="text-sm text-slate-900">{item.statement}</p>

                  <p className="text-xs text-slate-500">
                    來源：{item.source_label}
                    {item.source_url && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          原始連結
                        </a>
                      </>
                    )}
                    {item.source_note ? ` · ${item.source_note}` : ""}
                  </p>

                  {item.subject && item.predicate && (
                    <p className="text-xs text-slate-500">
                      關係：{item.subject} —{item.predicate}→{" "}
                      {item.object ?? "（未填）"}
                    </p>
                  )}

                  {item.status === "trashed" && item.trash_reason && (
                    <p className="text-xs text-slate-500">
                      丟棄理由：{item.trash_reason}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {mode === "trash" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(() => restorePkbItem(item.id), false)}
                      >
                        還原成待同意
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          disabled={pending || item.status === "active"}
                          onClick={() => run(() => approvePkbItem(item.id), false)}
                        >
                          同意
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => trashPkbItem(item.id), false)}
                        >
                          丟垃圾桶
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
