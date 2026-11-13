"use client";
/** One numbered, collapsible step of the designer sidebar (native <details>, so it works without extra state). */
import type { ReactNode } from "react";
import type { StepStatus } from "@/lib/omr/designer-steps";

const BADGE: Record<StepStatus, string> = {
  done: "bg-emerald-600 text-white",
  warn: "bg-amber-500 text-white",
  todo: "border border-[var(--border)] bg-[var(--surface)] text-zinc-500",
};

export default function StepSection({ n, label, status, defaultOpen = false, testId, children }: {
  n: number; label: string; status: StepStatus; defaultOpen?: boolean; testId?: string; children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="v-panel group overflow-hidden" data-testid={testId} data-status={status}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${BADGE[status]}`}>{status === "done" ? "✓" : status === "warn" ? "!" : n}</span>
        <span className="flex-1">{n}. {label}</span>
        <span className="sr-only">{status === "done" ? "complete" : status === "warn" ? "needs attention" : "to do"}</span>
        <span aria-hidden className="text-zinc-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-6 border-t border-[var(--border)] p-3">{children}</div>
    </details>
  );
}
