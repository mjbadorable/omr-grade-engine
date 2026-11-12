"use client";

import { useState } from "react";
import { type ImportResult, importRoster, rosterToCsv } from "@/lib/roster/importer";
import type { Reconciliation } from "@/lib/roster/reconcile";
import type { Roster } from "@/lib/roster/schema";

const BADGE: Record<string, string> = {
  MATCHED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  ABSENT: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  UNREGISTERED_STUDENT: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  UNREADABLE_ROLL: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};
const LABEL: Record<string, string> = { MATCHED: "Matched", ABSENT: "Absent", UNREGISTERED_STUDENT: "Not on roster", UNREADABLE_ROLL: "Roll unreadable" };

export default function RosterPanel({ roster, recon, onImport, onOpen, download }: {
  roster: Roster | null;
  recon: Reconciliation;
  onImport: (r: Roster) => void;
  onOpen: (sheetId: string) => void;
  download: (name: string, data: string, type: string) => void;
}) {
  const [last, setLast] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const s = recon.summary;
  const entries = filter === "all" ? recon.entries : recon.entries.filter((e) => e.status === filter);

  async function onFile(f?: File) {
    if (!f) return;
    const res = importRoster(await f.text(), { name: f.name.replace(/\.[^.]+$/, "") });
    setLast(res);
    if (res.roster.students.length) onImport(res.roster);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <label className="inline-flex cursor-pointer items-center rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
          Import roster CSV<input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <span className="text-zinc-500">{roster ? `${roster.name}: ${roster.students.length} students` : "No roster imported. Columns like Roll No / Student ID / LRN and Name / Full Name are detected automatically."}</span>
        {roster && <button type="button" className="ml-auto rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900" onClick={() => download(`${roster.name}.csv`, rosterToCsv(roster), "text/csv")}>Export roster</button>}
      </div>

      {last && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p>Imported <b>{last.roster.students.length}</b> students. Columns used: {Object.entries(last.mapping).map(([k, i]) => `${k} ← "${last.headers[i!]}"`).join(", ") || "none"}.</p>
          {last.issues.length > 0 && <ul className="mt-1 list-disc pl-5 text-amber-800 dark:text-amber-300">{last.issues.slice(0, 8).map((i, k) => <li key={k}>{i.message}</li>)}{last.issues.length > 8 && <li>… {last.issues.length - 8} more</li>}</ul>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {([["all", `All (${recon.entries.length})`], ["MATCHED", `Matched ${s.matched}`], ["ABSENT", `Absent ${s.absent}`], ["UNREGISTERED_STUDENT", `Not on roster ${s.unregistered}`], ["UNREADABLE_ROLL", `Unreadable ${s.unreadable}`]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 ${filter === k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>{label}</button>
        ))}
        {s.duplicates > 0 && <span className="self-center text-xs text-amber-700">{s.duplicates} student(s) scanned more than once</span>}
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="sticky top-0 border-b border-zinc-200 bg-white text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            <tr><th className="px-3 py-2">Status</th><th className="px-3">Roll</th><th className="px-3">Name</th><th className="px-3">Section</th><th className="px-3">Sheets</th></tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const sheets = "sheetIds" in e ? e.sheetIds : [];
              const st = "student" in e ? e.student : null;
              return (
                <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[e.status]}`}>{LABEL[e.status]}</span></td>
                  <td className="px-3 font-mono">{st?.rollNumber ?? (e.status === "UNREGISTERED_STUDENT" ? e.rollNumber : "–")}</td>
                  <td className="px-3">{st?.name ?? "–"}</td>
                  <td className="px-3">{st?.section ?? "–"}</td>
                  <td className="px-3">
                    {sheets.map((id, k) => <button key={id} type="button" onClick={() => onOpen(id)} className="mr-2 text-indigo-600 underline dark:text-indigo-400">{sheets.length > 1 ? `sheet ${k + 1}` : "open"}</button>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!entries.length && <p className="p-6 text-center text-sm text-zinc-500">Nothing here.</p>}
      </div>
    </div>
  );
}
