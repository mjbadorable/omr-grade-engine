"use client";
/** Small header pieces of the Gradebook: a dropdown action menu and the exam-status control. */
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export interface MenuItem { label: string; onClick: () => void; disabled?: boolean; title?: string; testId?: string; danger?: boolean }

/** Button that opens a short list of actions (closes on pick, outside click or Esc). */
export function ActionMenu({ label, items, primary = false, disabled = false, testId }: { label: string; items: MenuItem[]; primary?: boolean; disabled?: boolean; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={disabled} data-testid={testId} onClick={() => setOpen((o) => !o)}
        className={`v-btn min-h-10 px-4 ${primary ? "v-btn-primary" : ""}`}>
        {label}<span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" aria-label={label} className="v-panel absolute right-0 bg-[var(--surface)] top-full z-30 mt-2 w-56 space-y-1 p-2 shadow-xl">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} title={it.title} data-testid={it.testId}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`flex min-h-10 w-full items-center rounded-lg px-4 py-2 text-left text-sm hover:bg-[var(--brand-tint)] disabled:cursor-not-allowed disabled:opacity-40 ${it.danger ? "text-red-700 dark:text-red-300" : ""}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { draft: "Draft", open: "Open", closed: "Closed" };
const NEXT: Record<string, { to: "draft" | "open" | "closed"; label: string }> = {
  draft: { to: "open", label: "Open exam" },
  open: { to: "closed", label: "Close exam" },
  closed: { to: "open", label: "Reopen exam" },
};

/** Workspace exams only: shows the real status; admins can change it (the server enforces the role). */
export function ExamStatusControl({ examId, status, canChange }: { examId: Id<"exams">; status: string | null; canChange: boolean }) {
  const setStatus = useMutation(api.exams.setStatus);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!status) return null;
  const next = NEXT[status];
  return (
    <div className="flex items-center gap-2" data-testid="exam-status">
      <span className={`v-badge ${status === "open" ? "v-badge-ok" : status === "draft" ? "v-badge-gold" : ""}`}>{STATUS_LABEL[status] ?? status}</span>
      {canChange && next && (
        <button type="button" className="v-btn min-h-10 px-4" disabled={busy} data-testid="exam-status-action"
          onClick={() => { setBusy(true); setErr(null); setStatus({ examId, status: next.to }).catch((e) => setErr((e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? "Could not change the status.")).finally(() => setBusy(false)); }}>
          {busy ? "Saving…" : next.label}
        </button>
      )}
      {err && <span role="alert" className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
