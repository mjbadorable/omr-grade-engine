"use client";

import { useMemo, useState } from "react";
import { duplicateRolls, sheetStatus, type SheetStatusId } from "@/lib/grading/grade-summary";
import type { ScoredSheet } from "@/lib/grading/types";

const STATUS_BADGE: Record<SheetStatusId, string> = { graded: "v-badge-ok", "needs-review": "v-badge-gold", duplicate: "v-badge-warn" };

type SortKey = "name" | "rollNumber" | "examSet" | "totalScore" | "percentage" | "accuracy" | "flags" | "grade";

export default function Gradebook({ sheets, onOpen, names }: { sheets: ScoredSheet[]; onOpen: (sheetId: string) => void; names: Map<string, string> }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "totalScore", dir: -1 });
  const [q, setQ] = useState("");

  const dupes = useMemo(() => duplicateRolls(sheets), [sheets]);

  const rows = useMemo(() => {
    const flags = (s: ScoredSheet) => s.flaggedCount + s.sheetFlags.length + (dupes.has(s.rollNumber ?? "") ? 1 : 0);
    const val = (s: ScoredSheet): string | number => (sort.key === "flags" ? flags(s) : sort.key === "name" ? names.get(s.sheetId) ?? "\uffff" : (s[sort.key] ?? ""));
    const ql = q.toLowerCase();
    const filtered = q ? sheets.filter((s) => (s.rollNumber ?? "").includes(q) || s.sheetId.includes(q) || (names.get(s.sheetId) ?? "").toLowerCase().includes(ql)) : sheets;
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    }).map((s) => ({ s, flags: flags(s) }));
  }, [sheets, sort, q, dupes, names]);

  const th = (key: SortKey, label: string, right = false) => (
    <th scope="col" className={`px-3 py-2 ${right ? "text-right" : ""}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-zinc-900 dark:hover:text-zinc-100"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === "rollNumber" || key === "examSet" || key === "name" ? 1 : -1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <input id="gradebook-filter" name="gradebook-filter" type="search" aria-label="Filter students" autoComplete="off" placeholder="Filter by name or roll number…" value={q} onChange={(e) => setQ(e.target.value)}
        className="v-input w-full max-w-xs" />
      <div className="v-panel max-h-[70vh] overflow-auto">
        <table className="v-table min-w-[640px]">
          <thead className="sticky top-0 z-10">
            <tr>{th("name", "Student")}{th("rollNumber", "Roll")}{th("examSet", "Set")}{th("totalScore", "Score", true)}{th("percentage", "%", true)}{th("grade", "Grade")}{th("accuracy", "Accuracy", true)}{th("flags", "Status")}</tr>
          </thead>
          <tbody>
            {rows.map(({ s, flags }) => (
              <tr key={s.sheetId} onClick={() => onOpen(s.sheetId)} className="cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-700/10">
                <td className="px-3 py-1.5">{names.get(s.sheetId) ?? <span className="text-xs text-amber-700">not on roster</span>}</td>
                <td className="px-3 font-mono">{s.rollNumber ?? <span className="text-red-600">unreadable</span>}</td>
                <td className="px-3">{s.examSet ?? "–"}</td>
                <td className="px-3 text-right tabular-nums">{s.totalScore} / {s.maxScore}</td>
                <td className="px-3 text-right tabular-nums">{s.percentage.toFixed(1)}</td>
                <td className="px-3">{s.grade ?? "–"}</td>
                <td className="px-3 text-right tabular-nums">{(s.accuracy * 100).toFixed(0)}%</td>
                <td className="px-3">{(() => { const st = sheetStatus(s, dupes.has(s.rollNumber ?? "")); return <span className={`v-badge ${STATUS_BADGE[st.status]}`} data-testid="sheet-status" data-status={st.status} title={flags ? `${flags} item${flags === 1 ? "" : "s"} to check` : undefined}>{st.label}</span>; })()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-sm text-zinc-500">No graded sheets.</p>}
      </div>
    </div>
  );
}
