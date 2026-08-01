"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  approveCandidate,
  approveWithEdit,
  markNeedsFix,
  reextractParagraph,
  rejectCandidate,
  reopenCandidate,
  splitCandidate,
  type ReviewResult,
} from "@/app/review/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CONDITION_LABEL,
  KNOWLEDGE_TYPE_LABEL,
  RISK_LEVEL_LABEL,
} from "@/lib/facts/labels";
import type { CandidateFactRow } from "@/lib/supabase/types";

const CONDITION_KEYS = [
  "population",
  "exposure_route",
  "dose",
  "duration",
  "location",
  "timeframe",
] as const;

export function FactEditor({ fact }: { fact: CandidateFactRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReviewResult>({ status: "idle" });

  const [statement, setStatement] = useState(fact.statement);
  const [subject, setSubject] = useState(fact.subject ?? "");
  const [predicate, setPredicate] = useState(fact.predicate ?? "");
  const [object, setObject] = useState(fact.object ?? "");
  const [knowledgeType, setKnowledgeType] = useState(fact.knowledge_type);
  const [riskLevel, setRiskLevel] = useState(fact.risk_level);
  const [note, setNote] = useState("");
  const [conditions, setConditions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of CONDITION_KEYS) {
      const value = (fact.conditions as Record<string, string | null>)?.[key];
      initial[key] = value ?? "";
    }
    return initial;
  });

  const [splitInput, setSplitInput] = useState("");
  const [splitOpen, setSplitOpen] = useState(false);

  function run(work: () => Promise<ReviewResult>) {
    startTransition(async () => {
      const outcome = await work();
      setResult(outcome);
      if (outcome.status === "success") router.refresh();
    });
  }

  function handleApproveWithEdit() {
    run(() =>
      approveWithEdit(fact.id, {
        statement,
        subject: subject.trim() || null,
        predicate: predicate.trim() || null,
        object: object.trim() || null,
        knowledge_type: knowledgeType,
        risk_level: riskLevel,
        conditions: Object.fromEntries(
          CONDITION_KEYS.map((key) => [key, conditions[key].trim() || null]),
        ),
        note: note.trim() || undefined,
      }),
    );
  }

  const dirty =
    statement !== fact.statement ||
    subject !== (fact.subject ?? "") ||
    predicate !== (fact.predicate ?? "") ||
    object !== (fact.object ?? "") ||
    knowledgeType !== fact.knowledge_type ||
    riskLevel !== fact.risk_level ||
    CONDITION_KEYS.some(
      (key) =>
        conditions[key] !==
        ((fact.conditions as Record<string, string | null>)?.[key] ?? ""),
    );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="statement">事實敘述</Label>
        <Textarea
          id="statement"
          rows={3}
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
        />
        <p className="text-xs text-slate-500">
          修改後按「修正後核定」，系統會用同一套自動品質檢查重新評分，
          不會因為手動修改而跳過檢查。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="subject">主體</Label>
          <Input
            id="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="predicate">關係</Label>
          <Input
            id="predicate"
            value={predicate}
            onChange={(event) => setPredicate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="object">客體或值</Label>
          <Input
            id="object"
            value={object}
            onChange={(event) => setObject(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="knowledge-type">知識類型</Label>
          <select
            id="knowledge-type"
            value={knowledgeType}
            onChange={(event) =>
              setKnowledgeType(
                event.target.value as CandidateFactRow["knowledge_type"],
              )
            }
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
          >
            {Object.entries(KNOWLEDGE_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="risk-level">風險等級</Label>
          <select
            id="risk-level"
            value={riskLevel}
            onChange={(event) =>
              setRiskLevel(event.target.value as CandidateFactRow["risk_level"])
            }
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
          >
            {Object.entries(RISK_LEVEL_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">
          條件與限制（保留原文的族群、劑量、時間等資訊）
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {CONDITION_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`condition-${key}`}>{CONDITION_LABEL[key]}</Label>
              <Input
                id={`condition-${key}`}
                value={conditions[key]}
                onChange={(event) =>
                  setConditions((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="note">審核備註（選填）</Label>
        <Input
          id="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="會記錄在審核歷程中"
        />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <Button
          disabled={pending || dirty}
          onClick={() =>
            run(() => approveCandidate(fact.id, note.trim() || undefined))
          }
          title={dirty ? "有未儲存的修改，請使用「修正後核定」" : undefined}
        >
          核定
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={handleApproveWithEdit}
        >
          修正後核定
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => rejectCandidate(fact.id, note.trim() || undefined))
          }
        >
          駁回
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => markNeedsFix(fact.id, note.trim() || undefined))}
        >
          標記待確認
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => setSplitOpen((open) => !open)}
        >
          拆成多筆
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => reextractParagraph(fact.source_id, fact.source_paragraph_id))
          }
        >
          重新抽取本段
        </Button>
        {fact.status !== "pending" && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => reopenCandidate(fact.id))}
          >
            退回待審核
          </Button>
        )}
      </div>

      {splitOpen && (
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          <Label htmlFor="split-input">拆分成多筆（一行一筆）</Label>
          <Textarea
            id="split-input"
            rows={4}
            value={splitInput}
            onChange={(event) => setSplitInput(event.target.value)}
            placeholder={
              "氫氟酸接觸皮膚可能造成深層灼傷。\n接觸後應立即以大量清水沖洗。"
            }
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() =>
                splitCandidate(fact.id, splitInput, note.trim() || undefined),
              )
            }
          >
            確認拆分
          </Button>
          <p className="text-xs text-slate-500">
            拆分後會建立多筆待審核事實，原本這筆會標記為已拆分並保留紀錄。
          </p>
        </div>
      )}

      {result.status !== "idle" && (
        <p
          role="status"
          className={`text-sm ${
            result.status === "error" ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
