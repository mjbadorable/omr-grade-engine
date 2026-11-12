"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReviewCanvas from "@/components/scanner/ReviewCanvas";
import type { AnswerKey, ScoredSheet } from "@/lib/grading/types";
import { describePatch, effectivePatches, makePatch, type ManualOverridePatch } from "@/lib/review/overrides";
import type { Student } from "@/lib/roster/schema";
import type { StoredScan } from "@/lib/storage/scan-store";
import type { DecodedFields } from "@/lib/vision/types";

const STATUS_STYLE: Record<string, string> = {
  CORRECT: "text-emerald-700 dark:text-emerald-400",
  PARTIAL: "text-sky-700 dark:text-sky-400",
  INCORRECT: "text-red-700 dark:text-red-400",
  OMITTED: "text-zinc-400",
  FLAGGED_CONFLICT: "font-semibold text-amber-700 dark:text-amber-400",
};
const L = (i: number) => String.fromCharCode(65 + i);
const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900";

export interface ReviewModalProps {
  sheet: ScoredSheet;
  /** raw (immutable) scanner record; null for simulated sheets */
  scan: StoredScan | null;
  rawFields: DecodedFields;
  patches: ManualOverridePatch[];
  answerKey: AnswerKey;
  student: Student | null;
  teacherId: string;
  onPatches: (patches: ManualOverridePatch[]) => void;
  onScorecard: () => void;
  onClose: () => void;
}

export default function ReviewModal({ sheet, scan, rawFields, patches, answerKey, student, teacherId, onPatches, onScorecard, onClose }: ReviewModalProps) {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [draft, setDraft] = useState<Map<number, number[]>>(new Map());
  const [roll, setRoll] = useState(sheet.rollNumber ?? "");
  const [set, setSet] = useState(sheet.examSet ?? "");
  const [reason, setReason] = useState("Verified against the paper sheet");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    let made: ImageBitmap | null = null;
    if (scan?.preview) createImageBitmap(scan.preview).then((b) => { if (alive) { made = b; setBmp(b); } else b.close(); });
    return () => { alive = false; made?.close(); };
  }, [scan]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confidence = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of scan?.result.bubbles ?? []) if (b.field === "answer") m.set(b.questionIndex + 1, Math.min(m.get(b.questionIndex + 1) ?? 1, b.confidence));
    return m;
  }, [scan]);
  const highlight = useMemo(() => new Set(rawFields.conflicts.flatMap((c) => c.bubbleIds)), [rawFields]);
  const active = useMemo(() => effectivePatches(patches), [patches]);
  const rawAnswer = useMemo(() => new Map(rawFields.answers.map((a) => [a.questionNumber, a])), [rawFields]);
  const setOptions = Object.keys(answerKey.sets);

  function base(target: ManualOverridePatch["target"], questionNumber: number, originalState: ManualOverridePatch["originalState"], overriddenOption: ManualOverridePatch["overriddenOption"]) {
    return makePatch({ sheetId: sheet.sheetId, target, questionNumber, originalState, overriddenOption, reason: reason.trim(), teacherId });
  }

  function saveAll() {
    const out: ManualOverridePatch[] = [];
    for (const [q, marked] of draft) {
      const r = rawAnswer.get(q);
      out.push(base("answer", q, { marked: r?.marked ?? [], labels: r?.labels ?? [], uncertain: r?.uncertain ?? false }, marked));
    }
    if (roll.trim() && roll.trim() !== (sheet.rollNumber ?? "")) out.push(base("roll", 0, { value: rawFields.rollNumber }, roll.trim()));
    if (set !== (sheet.examSet ?? "")) out.push(base("set", 0, { value: rawFields.examSet }, set));
    if (out.length) onPatches(out);
    setDraft(new Map());
  }

  const pendingChanges = draft.size + (roll.trim() && roll.trim() !== (sheet.rollNumber ?? "") ? 1 : 0) + (set !== (sheet.examSet ?? "") ? 1 : 0);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Review sheet ${sheet.rollNumber ?? sheet.sheetId}`} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-7xl rounded-xl bg-white p-4 shadow-xl dark:bg-zinc-950">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{student?.name ?? "Unregistered student"}</h2>
          <span className="text-sm text-zinc-500">Roll {sheet.rollNumber ?? "unreadable"} · Set {sheet.examSet ?? "–"} · {sheet.totalScore}/{sheet.maxScore} ({sheet.percentage.toFixed(1)} %) · grade {sheet.grade ?? "–"} · key v{sheet.keyVersion}</span>
          {sheet.sheetFlags.length > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{sheet.sheetFlags.join(", ")}</span>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onScorecard} className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">Scorecard PDF</button>
            <button ref={closeRef} type="button" onClick={onClose} className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">✕</button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <label className="flex flex-col gap-1">Roll number<input className={`${input} w-36 font-mono`} value={roll} onChange={(e) => setRoll(e.target.value.replace(/[^0-9A-Za-z-]/g, ""))} /></label>
          {setOptions.length > 0 && (
            <label className="flex flex-col gap-1">Exam set
              <select className={input} value={set} onChange={(e) => setSet(e.target.value)}>
                <option value="">(unread)</option>
                {setOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">Reason (saved in the audit log)<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" disabled={!pendingChanges || !reason.trim()} onClick={saveAll}
            className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
            Save {pendingChanges || ""} change{pendingChanges === 1 ? "" : "s"}
          </button>
          {draft.size > 0 && <button type="button" className="text-sm text-zinc-500 underline" onClick={() => setDraft(new Map())}>discard</button>}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
          <div>
            {scan?.preview ? <ReviewCanvas result={scan.result} preview={bmp} highlight={highlight} />
              : <div className="grid h-64 place-items-center rounded-md border border-dashed border-zinc-300 text-sm text-zinc-500">{scan ? "Synced from another device: no image on this device." : "Simulated sheet: no scan image."}</div>}
            <AuditLog patches={patches} active={active} onRevert={(p) => onPatches([base(p.target, p.questionNumber, p.originalState, null)])} />
          </div>
          <div className="max-h-[72vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
                <tr><th className="py-1 pr-3">Q</th><th className="pr-3">Marks (click to correct)</th><th className="pr-3">Key</th><th>Status</th><th className="pl-3 text-right">Pts</th><th className="pl-3 text-right" title="Lowest bubble confidence from the scanner">Conf.</th></tr>
              </thead>
              <tbody>
                {sheet.items.map((i) => {
                  const rule = answerKey.questions.get(i.questionNumber);
                  const c = confidence.get(i.printedNumber);
                  const editable = rule?.type === "choice";
                  const effective = rawAnswer.get(i.printedNumber);
                  const overridden = active.has(`answer:${i.printedNumber}`);
                  const currentPrinted = draft.get(i.printedNumber) ?? (overridden ? (active.get(`answer:${i.printedNumber}`)!.overriddenOption as number[]) : effective?.marked ?? []);
                  return (
                    <tr key={i.questionNumber} className={`border-t border-zinc-100 dark:border-zinc-800 ${i.status === "FLAGGED_CONFLICT" ? "bg-amber-50/70 dark:bg-amber-500/5" : ""}`}>
                      <td className="py-1 pr-3 font-mono">{i.questionNumber}{i.printedNumber !== i.questionNumber && <span className="text-xs text-zinc-400"> ({i.printedNumber})</span>}</td>
                      <td className="pr-3">
                        {editable ? (
                          <div className="flex items-center gap-1" role="group" aria-label={`Marks for question ${i.questionNumber}`}>
                            {Array.from({ length: rule.optionCount }, (_, o) => {
                              const on = currentPrinted.includes(o);
                              return (
                                <button key={o} type="button" aria-pressed={on}
                                  onClick={() => setDraft((d) => new Map(d).set(i.printedNumber, on ? currentPrinted.filter((x) => x !== o) : [...currentPrinted, o].sort()))}
                                  className={`size-6 rounded-full border text-[11px] font-semibold ${on ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-500 hover:border-zinc-500 dark:border-zinc-600"}`}>
                                  {L(o)}
                                </button>
                              );
                            })}
                            {i.status === "FLAGGED_CONFLICT" && !draft.has(i.printedNumber) && (
                              <button type="button" title="Accept the filled bubbles as the answer (the unclear mark is a stray)"
                                onClick={() => setDraft((d) => new Map(d).set(i.printedNumber, currentPrinted))}
                                className="ml-1 rounded border border-emerald-600 px-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400">confirm</button>
                            )}
                            {draft.has(i.printedNumber) && <span className="ml-1 text-[11px] font-medium text-indigo-600">edited</span>}
                            {!draft.has(i.printedNumber) && overridden && <span className="ml-1 text-[11px] font-medium text-violet-600" title="Teacher override in effect">override</span>}
                          </div>
                        ) : <span className="font-mono">{i.answerText || "–"}</span>}
                      </td>
                      <td className="pr-3 font-mono text-zinc-500">{i.correctLabels.join(" ") || "–"}</td>
                      <td className={`text-xs ${STATUS_STYLE[i.status]}`}>{i.status.replace("_", " ").toLowerCase()}</td>
                      <td className="pl-3 text-right tabular-nums">{i.scoreEarned}</td>
                      <td className={`pl-3 text-right tabular-nums ${c !== undefined && c < 0.6 ? "text-amber-700" : "text-zinc-500"}`}>{c === undefined ? "–" : c.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-zinc-500">Marks are shown in printed order. Corrections never change the stored scan; each one is an audit-logged patch and the score updates instantly.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditLog({ patches, active, onRevert }: { patches: ManualOverridePatch[]; active: Map<string, ManualOverridePatch>; onRevert: (p: ManualOverridePatch) => void }) {
  if (!patches.length) return <p className="mt-3 text-xs text-zinc-500">No manual changes. The scanner&apos;s reading is in effect.</p>;
  const sorted = [...patches].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Audit log ({patches.length})</p>
      <ul className="space-y-1 text-xs">
        {sorted.map((p) => {
          const live = [...active.values()].includes(p);
          return (
            <li key={p.id} className="flex items-start gap-2">
              <span className={`mt-1 size-1.5 shrink-0 rounded-full ${live ? "bg-violet-500" : "bg-zinc-300"}`} />
              <span className={`flex-1 ${live ? "" : "text-zinc-400"}`}>{describePatch(p)}</span>
              {live && <button type="button" className="text-violet-700 underline dark:text-violet-300" onClick={() => onRevert(p)}>revert</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
