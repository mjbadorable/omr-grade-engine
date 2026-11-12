"use client";
/** Header badge for the offline outbox: "Saved Offline · Queued for Sync (N)" → "All Changes Synced". */
import { useEffect, useRef, useState } from "react";
import { syncBadge, type SyncTone } from "@/lib/sync/sync-status";
import { useCloudSession } from "./CloudSession";

const TONE: Record<SyncTone, string> = {
  synced: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200",
  syncing: "border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200",
  offline: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
  attention: "border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200",
};
const DOT: Record<SyncTone, string> = { synced: "bg-emerald-500", syncing: "animate-pulse bg-indigo-500", offline: "bg-amber-500", attention: "bg-red-500" };

export default function SyncBadge() {
  const s = useCloudSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!s || !s.isAuthenticated || !s.me || !s.selection.orgId) return null;
  const { sync } = s;
  const view = syncBadge(sync);
  const hasDetails = sync.notices.length > 0 || sync.pending > 0;
  return (
    <div className="relative" ref={ref}>
      <button type="button" data-testid="sync-badge" data-tone={view.tone} aria-live="polite" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE[view.tone]}`}>
        <span className={`size-2 rounded-full ${DOT[view.tone]}`} />
        {view.label}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
          {!hasDetails && <p className="text-zinc-500">Everything you did is saved in the cloud.</p>}
          {sync.pending > 0 && (
            <div>
              <p className="font-medium">Waiting to sync</p>
              <ul className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-400">
                {(["UPDATE_ANSWER_KEY", "APPLY_OVERRIDE", "RESOLVE_CONFLICT", "UPLOAD_SCAN"] as const).map((k) => {
                  const n = sync.pendingOps.filter((o) => o.kind === k).length;
                  return n ? <li key={k}>{n} × {{ UPDATE_ANSWER_KEY: "answer key save", APPLY_OVERRIDE: "grade correction", RESOLVE_CONFLICT: "conflict resolution", UPLOAD_SCAN: "scan upload" }[k]}</li> : null;
                })}
              </ul>
              {sync.online && <button type="button" className="mt-2 rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700" onClick={() => void sync.drain()}>Sync now</button>}
            </div>
          )}
          {sync.notices.map((n) => (
            <div key={n.id} className={`flex gap-2 rounded p-2 ${n.level === "error" ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200" : n.level === "warn" ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "bg-zinc-50 dark:bg-zinc-900"}`}>
              <span className="flex-1">{n.message}</span>
              <button type="button" aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100" onClick={() => sync.dismissNotice(n.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
