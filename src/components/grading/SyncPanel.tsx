"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncReport } from "@/lib/sync/sync-outbox";

export default function SyncPanel({ pending, teacherId, endpoint, onTeacher, onEndpoint, onSync }: {
  pending: number;
  teacherId: string;
  endpoint: string;
  onTeacher: (v: string) => void;
  onEndpoint: (v: string) => void;
  onSync: () => Promise<SyncReport | null>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${pending ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"}`}>
        <span className={`size-2 rounded-full ${endpoint ? (pending ? "bg-amber-500" : "bg-emerald-500") : "bg-zinc-400"}`} />
        {pending ? `${pending} to sync` : endpoint ? "Synced" : "Offline"}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 space-y-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-xs text-zinc-500">Every scan, key version, correction and roster import is queued locally (works offline) and sent in order when a server is configured.</p>
          <label className="block">Teacher name<input className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" defaultValue={teacherId} onBlur={(e) => onTeacher(e.target.value)} /></label>
          <label className="block">Sync server URL<input className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900" placeholder="https://your-backend/api/omr-sync" defaultValue={endpoint} onBlur={(e) => onEndpoint(e.target.value)} /></label>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!endpoint || busy} className="rounded-md bg-indigo-600 px-3 py-1 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              onClick={async () => { setBusy(true); try { setReport(await onSync()); } finally { setBusy(false); } }}>{busy ? "Syncing…" : "Sync now"}</button>
            <span className="text-xs text-zinc-500">{pending} queued</span>
          </div>
          {report && (
            <p className={`text-xs ${report.error ? "text-red-600" : "text-emerald-700"}`}>
              {report.error ? `Stopped: ${report.error}. Queued changes are kept and retried in order.` : `Sent ${report.pushed}, received ${report.pulled}${report.superseded ? `, ${report.superseded} older key versions folded` : ""}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
