"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReviewCanvas from "@/components/scanner/ReviewCanvas";
import type { ScoredSheet } from "@/lib/grading/types";
import type { StoredScan } from "@/lib/storage/scan-store";

const STATUS_STYLE: Record<string, string> = {
  CORRECT: "text-emerald-700 dark:text-emerald-400",
  PARTIAL: "text-sky-700 dark:text-sky-400",
  INCORRECT: "text-red-700 dark:text-red-400",
  OMITTED: "text-zinc-400",
  FLAGGED_CONFLICT: "font-semibold text-amber-700 dark:text-amber-400",
};

export default function InspectModal({ sheet, scan, onClose }: { sheet: ScoredSheet; scan: StoredScan | null; onClose: () => void }) {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
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

  /** lowest bubble confidence per printed question (from the scanner) */
  const confidence = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of scan?.result.bubbles ?? []) {
      if (b.field !== "answer") continue;
      const q = b.questionIndex + 1;
      m.set(q, Math.min(m.get(q) ?? 1, b.confidence));
    }
    return m;
  }, [scan]);

  const highlight = useMemo(() => new Set(scan?.result.fields.conflicts.flatMap((c) => c.bubbleIds) ?? []), [scan]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Sheet ${sheet.rollNumber ?? sheet.sheetId}`} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl rounded-xl bg-white p-4 shadow-xl dark:bg-zinc-950">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Roll {sheet.rollNumber ?? "unreadable"}</h2>
          <span className="text-sm text-zinc-500">Set {sheet.examSet ?? "–"} · {sheet.totalScore}/{sheet.maxScore} ({sheet.percentage.toFixed(1)} %) · grade {sheet.grade ?? "–"} · key v{sheet.keyVersion}</span>
          {sheet.sheetFlags.length > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{sheet.sheetFlags.join(", ")}</span>}
          <button ref={closeRef} type="button" onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">✕</button>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div>
            {scan ? <ReviewCanvas result={scan.result} preview={bmp} highlight={highlight} />
              : <div className="grid h-64 place-items-center rounded-md border border-dashed border-zinc-300 text-sm text-zinc-500">Simulated sheet: no scan image.</div>}
            {scan && <p className="mt-2 text-xs text-zinc-500">Green = filled, orange = partial, purple = erasure, red = needs review. {scan.name}</p>}
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
                <tr><th className="py-1 pr-3">Q</th><th className="pr-3">Marked</th><th className="pr-3">Key</th><th>Status</th><th className="pl-3 text-right">Pts</th><th className="pl-3 text-right" title="Lowest bubble confidence from the scanner">Conf.</th></tr>
              </thead>
              <tbody>
                {sheet.items.map((i) => {
                  const c = confidence.get(i.printedNumber);
                  return (
                    <tr key={i.questionNumber} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1 pr-3 font-mono">{i.questionNumber}{i.printedNumber !== i.questionNumber && <span className="text-xs text-zinc-400"> ({i.printedNumber})</span>}</td>
                      <td className="pr-3 font-mono">{i.answerText ?? (i.selectedLabels.join("") || "–")}</td>
                      <td className="pr-3 font-mono text-zinc-500">{i.correctLabels.join(" ") || "–"}</td>
                      <td className={`text-xs ${STATUS_STYLE[i.status]}`}>{i.status.replace("_", " ").toLowerCase()}{i.notes.length ? ` · ${i.notes.join(", ").toLowerCase().replace(/_/g, " ")}` : ""}</td>
                      <td className="pl-3 text-right tabular-nums">{i.scoreEarned}</td>
                      <td className={`pl-3 text-right tabular-nums ${c !== undefined && c < 0.6 ? "text-amber-700" : "text-zinc-500"}`}>{c === undefined ? "–" : c.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
