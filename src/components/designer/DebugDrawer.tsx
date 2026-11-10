"use client";

import { useMemo, useState } from "react";
import type { LayoutIssue, LayoutResult } from "@/lib/omr/layout-engine";

type Tab = "json" | "issues";

export default function DebugDrawer({ open, onClose, result, initialTab = "json" }: {
  open: boolean; onClose: () => void; result: LayoutResult; initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => (open ? JSON.stringify(result.template, null, 2) : ""), [open, result.template]);
  if (!open) return null;

  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex h-[46vh] flex-col border-t border-zinc-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,.08)] dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        {(["json", "issues"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm ${tab === t ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800"}`}>
            {t === "json" ? "template-coordinates.json" : `Validation (${errors.length} errors, ${warnings.length} warnings)`}
          </button>
        ))}
        <span className="ml-3 hidden font-mono text-xs text-zinc-500 sm:inline">
          {(json.length / 1024).toFixed(1)} KB · hash {result.template.layoutHash}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {tab === "json" && (
            <button type="button" className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              onClick={async () => { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close debug drawer">✕</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "json" ? (
          <pre className="p-4 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">{json}</pre>
        ) : (
          <IssueList issues={result.issues} />
        )}
      </div>
    </div>
  );
}

export function IssueList({ issues }: { issues: LayoutIssue[] }) {
  if (!issues.length)
    return <p className="p-4 text-sm text-emerald-700 dark:text-emerald-400">No issues: no overlaps, all elements inside the printable margin, every bubble inside its reference cell.</p>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {issues.map((i, k) => (
        <li key={k} className="flex gap-3 px-4 py-2 text-sm">
          <span className={`mt-0.5 h-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${i.severity === "error" ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"}`}>{i.severity}</span>
          <span className="font-mono text-xs text-zinc-500">{i.code}{i.page !== undefined ? ` · p${i.page + 1}` : ""}</span>
          <span className="text-zinc-800 dark:text-zinc-200">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}
