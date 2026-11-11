"use client";

import { useMemo, useState } from "react";
import type { ScoredSheet } from "@/lib/grading/types";

type SortKey = "name" | "rollNumber" | "examSet" | "totalScore" | "percentage" | "accuracy" | "flags" | "grade";

export default function Gradebook({ sheets, onOpen, names }: { sheets: ScoredSheet[]; onOpen: (sheetId: string) => void; names: Map<string, string> }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "totalScore", dir: -1 });
  const [q, setQ] = useState("");

  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of sheets) if (s.rollNumber) seen.set(s.rollNumber, (seen.get(s.rollNumber) ?? 0) + 1);
    return seen;
  }, [sheets]);

  const rows = useMemo(() => {
    const flags = (s: ScoredSheet) => s.flaggedCount + s.sheetFlags.length + ((dupes.get(s.rollNumber ?? "") ?? 0) > 1 ? 1 : 0);
    const val = (s: ScoredSheet): string | number => (sort.key === "flags" ? flags(s) : sort.key === "name" ? names.get(s.sheetId) ?? "\uffff" : (s[sort.key] ?? ""));
    const ql = q.toLowerCase();
    const filtered = q ? sheets.filter((s) => (s.rollNumber ?? "").includes(q) || s.sheetId.includes(q) || (names.get(s.sheetId) ?? "").toLowerCase().includes(ql)) : sheets;
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    }).map((s) => ({ s, flags: flags(s) }));
  }, [sheets, sort, q, dupes, names]);

  const th = (key: SortKey, label: string, right = false) => (
    <th className={`px-3 py-2 ${right ? "text-right" : ""}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-zinc-900 dark:hover:text-zinc-100"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === "rollNumber" || key === "examSet" || key === "name" ? 1 : -1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <input type="search" placeholder="Filter by name or roll number…" value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-xs rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900" />
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 border-b border-zinc-200 bg-white text-xs tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            <tr>{th("name", "Student")}{th("rollNumber", "Roll")}{th("examSet", "Set")}{th("totalScore", "Score", true)}{th("percentage", "%", true)}{th("grade", "Grade")}{th("accuracy", "Accuracy", true)}{th("flags", "Flags", true)}</tr>
          </thead>
          <tbody>
            {rows.map(({ s, flags }) => (
              <tr key={s.sheetId} onClick={() => onOpen(s.sheetId)} className="cursor-pointer border-b border-zinc-100 hover:bg-indigo-50/60 dark:border-zinc-800 dark:hover:bg-indigo-500/10">
                <td className="px-3 py-1.5">{names.get(s.sheetId) ?? <span className="text-xs text-amber-700">not on roster</span>}</td>
                <td className="px-3 font-mono">{s.rollNumber ?? <span className="text-red-600">unreadable</span>}{(dupes.get(s.rollNumber ?? "") ?? 0) > 1 && <span className="ml-1 text-xs text-amber-600">dup</span>}</td>
                <td className="px-3">{s.examSet ?? "–"}</td>
                <td className="px-3 text-right tabular-nums">{s.totalScore} / {s.maxScore}</td>
                <td className="px-3 text-right tabular-nums">{s.percentage.toFixed(1)}</td>
                <td className="px-3">{s.grade ?? "–"}</td>
                <td className="px-3 text-right tabular-nums">{(s.accuracy * 100).toFixed(0)}%</td>
                <td className="px-3 text-right">{flags ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{flags}</span> : <span className="text-zinc-400">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-sm text-zinc-500">No graded sheets.</p>}
      </div>
    </div>
  );
}
