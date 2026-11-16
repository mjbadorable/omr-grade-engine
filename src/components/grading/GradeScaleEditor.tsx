"use client";

import { useEffect, useRef, useState } from "react";
import {
  bandsForPreset, bandsFromRows, cutoffRows, describeScale, detectScale, MAX_LABEL, MAX_ROWS, SCALE_PRESETS, validateRows, type ScaleId,
} from "@/lib/grading/grade-scales";
import type { GradeBand } from "@/lib/grading/types";

interface Draft { label: string; from: string }
const toDraft = (bands: readonly GradeBand[]): Draft[] => cutoffRows(bands).map((r) => ({ label: r.label, from: String(r.from) }));
const input = "v-input";

/** Preset scales plus an editable cutoff table. The stored shape is still `gradeBands`. */
export default function GradeScaleEditor({ bands, onChange }: { bands: GradeBand[]; onChange: (b: GradeBand[]) => void }) {
  const detected = detectScale(bands);
  const [rows, setRows] = useState<Draft[]>(() => toDraft(bands));
  const [error, setError] = useState<string | null>(null);
  const applied = useRef(JSON.stringify(bands));

  // follow changes that did not come from this table (import, reset, another teacher)
  const sig = JSON.stringify(bands);
  useEffect(() => { if (sig !== applied.current) { applied.current = sig; setRows(toDraft(bands)); setError(null); } }, [sig, bands]);

  const commit = (next: GradeBand[]) => { applied.current = JSON.stringify(next); onChange(next); };
  const edit = (next: Draft[], rounded = detected.rounded) => {
    setRows(next);
    const numeric = next.map((r) => ({ label: r.label, from: r.from.trim() === "" ? Number.NaN : Number(r.from) }));
    const problem = validateRows(numeric);
    setError(problem);
    if (!problem) commit(bandsFromRows(numeric, rounded));
  };
  const pick = (id: ScaleId) => { const b = bandsForPreset(id); setRows(toDraft(b)); setError(null); commit(b); };

  return (
    <div className="space-y-3" data-testid="grade-scale">
      <p className="rounded-lg bg-[var(--bg)] px-3 py-2 text-sm" data-testid="scale-current" role="status">
        <span className="text-zinc-500">Currently using: </span><b>{describeScale(bands)}</b>
      </p>

      <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Grading scale</span>
        <select name="grade-scale" aria-label="Grading scale" className={`${input} w-full`} value={detected.id} onChange={(e) => { if (e.target.value !== "custom") pick(e.target.value as ScaleId); }}>
          {SCALE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {detected.id === "custom" && <option value="custom">Custom (edited below)</option>}
        </select>
      </label>
      {detected.id !== "custom" && <p className="text-xs text-zinc-500">{SCALE_PRESETS.find((p) => p.id === detected.id)!.hint}</p>}

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" name="round-percent" className="mt-0.5 accent-indigo-600" checked={detected.rounded}
          onChange={(e) => edit(rows, e.target.checked)} />
        <span>Round the percentage to the nearest whole number first<span className="block text-xs text-zinc-500">So 74.5% counts as 75%.</span></span>
      </label>

      <table className="w-full text-sm" data-testid="cutoff-table">
        <thead><tr className="text-left text-xs text-zinc-500"><th className="pb-1 font-medium">Grade</th><th className="pb-1 font-medium">From (%)</th><th className="w-8"><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="pr-2 pb-1"><input name={`grade-label-${i}`} aria-label={`Grade ${i + 1} name`} className={`${input} w-full`} maxLength={MAX_LABEL} value={r.label} onChange={(e) => edit(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
              <td className="pr-2 pb-1"><input name={`grade-from-${i}`} aria-label={`Grade ${i + 1} starts at percent`} className={`${input} w-full`} inputMode="decimal" value={r.from} onChange={(e) => edit(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} /></td>
              <td className="pb-1"><button type="button" className="rounded px-1.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label={`Remove grade ${r.label || i + 1}`} disabled={rows.length <= 1} onClick={() => edit(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2">
        <button type="button" className="v-btn !px-2.5 !py-1" disabled={rows.length >= MAX_ROWS} onClick={() => edit([...rows, { label: "", from: "" }])}>Add grade</button>
        <span className="text-xs text-zinc-500">A grade starts at its percent and runs up to the next one.</span>
      </div>
      {error && <p role="alert" data-testid="scale-error" className="text-xs text-red-700 dark:text-red-300">{error} The previous scale is still in use.</p>}
    </div>
  );
}
