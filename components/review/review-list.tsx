"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  approveCandidate,
  batchReview,
  markNeedsFix,
  mergeCandidates,
  rejectCandidate,
  type ReviewResult,
} from "@/app/review/actions";
import { FeedbackButton } from "@/components/review/feedback-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  CANDIDATE_STATUS_CLASS,
  CANDIDATE_STATUS_LABEL,
  CONDITION_LABEL,
  KNOWLEDGE_TYPE_LABEL,
  RISK_LEVEL_CLASS,
  RISK_LEVEL_LABEL,
  qualityFlagLabel,
} from "@/lib/facts/labels";
import { isBatchApprovable } from "@/lib/facts/review";
import { formatDateTime } from "@/lib/jobs/labels";
import type { CandidateFactRow } from "@/lib/supabase/types";

export function ReviewList({ facts }: { facts: CandidateFactRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ReviewResult>({ status: "idle" });
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeStatement, setMergeStatement] = useState("");
  const selectAllRef = useRef<HTMLInputElement>(null);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectBatchApprovable() {
    setSelected(new Set(facts.filter(isBatchApprovable).map((fact) => fact.id)));
  }

  /** 全選只作用於目前畫面上的清單（已套用篩選與筆數上限）。 */
  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(facts.map((fact) => fact.id)) : new Set());
  }

  function run(work: () => Promise<ReviewResult>, clearSelection = true) {
    startTransition(async () => {
      const outcome = await work();
      setResult(outcome);
      if (outcome.status === "success") {
        if (clearSelection) setSelected(new Set());
        setMergeOpen(false);
        setMergeStatement("");
        router.refresh();
      }
    });
  }

  const selectedIds = [...selected];
  const batchApprovableCount = facts.filter(isBatchApprovable).length;

  const allSelected = facts.length > 0 && selected.size === facts.length;
  const someSelected = selected.size > 0 && !allSelected;

  // indeterminate 只能用 DOM property 設定，沒有對應的 React 屬性。
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              ref={selectAllRef}
              type="checkbox"
              aria-label="全選本頁候選事實"
              checked={allSelected}
              onChange={(event) => toggleAll(event.target.checked)}
              disabled={pending || facts.length === 0}
              className="h-4 w-4 rounded border-slate-300"
            />
            全選
          </label>

          <span className="text-sm text-slate-600">
            已選取 {selected.size} 筆（本頁共 {facts.length} 筆）
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={selectBatchApprovable}
            disabled={pending || batchApprovableCount === 0}
          >
            選取可批次核定的 {batchApprovableCount} 筆
          </Button>

          <Button
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() => run(() => batchReview(selectedIds, "approve"))}
          >
            批次核定
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() => run(() => batchReview(selectedIds, "reject"))}
          >
            批次駁回
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() => run(() => batchReview(selectedIds, "needs_fix"))}
          >
            批次標記待確認
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={pending || selected.size < 2}
            onClick={() => setMergeOpen((open) => !open)}
          >
            合併選取的 {selected.size} 筆
          </Button>

          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={pending}
            >
              清除選取
            </Button>
          )}

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

          <p className="w-full text-xs text-slate-500">
            「可批次核定」的條件是：狀態為待審核、低風險，且沒有任何品質標記。
          </p>

          {mergeOpen && (
            <div className="w-full space-y-2 rounded-md border border-slate-200 p-3">
              <label className="block text-sm font-medium text-slate-800">
                合併後的事實敘述
              </label>
              <Textarea
                rows={3}
                value={mergeStatement}
                onChange={(event) => setMergeStatement(event.target.value)}
                placeholder="輸入合併後的單一敘述。原本的候選事實會標記為已合併並保留紀錄。"
              />
              <Button
                size="sm"
                disabled={pending || mergeStatement.trim().length === 0}
                onClick={() =>
                  run(() => mergeCandidates(selectedIds, mergeStatement))
                }
              >
                確認合併
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ul className="space-y-4">
        {facts.map((fact) => (
          <li key={fact.id}>
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`選取：${fact.statement}`}
                    checked={selected.has(fact.id)}
                    onChange={() => toggle(fact.id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <Badge className={CANDIDATE_STATUS_CLASS[fact.status]}>
                    {CANDIDATE_STATUS_LABEL[fact.status]}
                  </Badge>
                  <Badge className={RISK_LEVEL_CLASS[fact.risk_level]}>
                    {RISK_LEVEL_LABEL[fact.risk_level]}
                  </Badge>
                  <Badge className="bg-slate-100 text-slate-700">
                    {KNOWLEDGE_TYPE_LABEL[fact.knowledge_type]}
                  </Badge>
                  <span className="font-mono text-xs text-slate-500">
                    {fact.source_paragraph_id}
                  </span>
                  <span className="text-xs text-slate-500">
                    品質分數 {fact.quality_score}
                  </span>
                  {fact.edited && (
                    <Badge className="bg-purple-100 text-purple-800">已修正</Badge>
                  )}
                  <span className="ml-auto text-xs text-slate-400">
                    {formatDateTime(fact.created_at)}
                  </span>
                </div>

                <p className="text-sm font-medium text-slate-900">
                  {fact.statement}
                </p>

                <blockquote className="border-l-2 border-slate-300 pl-3 text-sm text-slate-600">
                  {fact.source_quote}
                </blockquote>

                {Object.entries(fact.conditions ?? {}).some(
                  ([, value]) => value,
                ) && (
                  <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                    {Object.entries(fact.conditions ?? {})
                      .filter(([, value]) => value)
                      .map(([key, value]) => (
                        <span
                          key={key}
                          className="rounded bg-slate-100 px-2 py-0.5"
                        >
                          {CONDITION_LABEL[key] ?? key}：{value}
                        </span>
                      ))}
                  </div>
                )}

                {fact.quality_flags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {fact.quality_flags.map((flag) => (
                      <Badge key={flag} className="bg-amber-100 text-amber-900">
                        {qualityFlagLabel(flag)}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <Button
                    size="sm"
                    disabled={pending || fact.status === "approved"}
                    onClick={() => run(() => approveCandidate(fact.id), false)}
                  >
                    核定
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || fact.status === "rejected"}
                    onClick={() => run(() => rejectCandidate(fact.id), false)}
                  >
                    駁回
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || fact.status === "needs_fix"}
                    onClick={() => run(() => markNeedsFix(fact.id), false)}
                  >
                    標記待確認
                  </Button>
                  <FeedbackButton candidateFactId={fact.id} />
                  <Link
                    href={`/review/${fact.id}`}
                    className="text-sm text-blue-700 underline"
                  >
                    開啟單筆審核（修正、拆分、前後文）
                  </Link>
                  <Link
                    href={`/sources/${fact.source_id}`}
                    className="ml-auto text-xs text-slate-500 underline hover:text-slate-800"
                  >
                    來源文件
                  </Link>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
