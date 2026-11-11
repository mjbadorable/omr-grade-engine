"use client";

import type { ConflictGroup, SyncedSheet } from "@/lib/sync/conflicts";

/** Divergent scans of one student (often from two teachers): pick the sheet that counts. */
export default function ConflictPanel({ groups, sheets, onKeep, onOpen }: {
  groups: ConflictGroup[];
  sheets: Map<string, SyncedSheet & { name?: string }>;
  onKeep: (group: ConflictGroup, keepSheetId: string) => void;
  onOpen: (sheetId: string) => void;
}) {
  const open = groups.filter((g) => g.kind === "DIVERGENT_ANSWERS" && !g.resolution);
  if (!open.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="font-semibold text-amber-900 dark:text-amber-200">
        {open.length} student{open.length > 1 ? "s were" : " was"} scanned more than once with different answers. These sheets are held for review; choose the one that counts.
      </p>
      {open.map((g) => (
        <div key={`${g.layoutHash}|${g.rollKey}`} className="rounded-md bg-white p-2 dark:bg-zinc-950">
          <p className="mb-1">Roll <b className="font-mono">{g.rollNumber}</b>{g.teachers.length > 1 ? ` · scanned by ${g.teachers.join(" and ")}` : g.crossDevice ? " · scanned on two devices" : ""} · differs on Q{g.differingQuestions.slice(0, 12).join(", Q")}{g.differingQuestions.length > 12 ? "…" : ""}</p>
          <div className="flex flex-wrap gap-2">
            {g.sheetIds.map((id) => {
              const s = sheets.get(id);
              return (
                <div key={id} className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700">
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">{s?.teacherId ?? "?"} · {s ? new Date(s.createdAt).toLocaleString() : ""}</span>
                  <button type="button" className="text-xs text-indigo-600 underline" onClick={() => onOpen(id)}>inspect</button>
                  <button type="button" className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-500" onClick={() => onKeep(g, id)}>Keep this</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
