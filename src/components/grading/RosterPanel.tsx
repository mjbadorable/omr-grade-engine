"use client";

import { useState } from "react";
import Select from "@/components/ui/Select";
import { type ImportResult, importRoster, rosterToCsv } from "@/lib/roster/importer";
import type { Reconciliation } from "@/lib/roster/reconcile";
import type { Roster } from "@/lib/roster/schema";
import type { ClassesPort } from "@/lib/classes/port";

const BADGE: Record<string, string> = {
  MATCHED: "v-badge-ok",
  ABSENT: "",
  UNREGISTERED_STUDENT: "v-badge-warn",
  UNREADABLE_ROLL: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};
const LABEL: Record<string, string> = { MATCHED: "Matched", ABSENT: "Absent", UNREGISTERED_STUDENT: "Not on roster", UNREADABLE_ROLL: "Roll unreadable" };

/** Pick a saved class to use for this exam (one click), or save the current roster as a class. */
function ClassPicker({ classes, roster, onAttach }: { classes: ClassesPort; roster: Roster | null; onAttach: (r: Roster) => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const where = classes.where === "cloud" ? "your account" : "this device";

  async function attach(id: string) {
    setBusy(true);
    const r = await classes.load(id).catch(() => null);
    setBusy(false);
    if (!r) { setMsg({ ok: false, text: "Could not open that class." }); return; }
    onAttach(r);
    setMsg({ ok: true, text: `Using ${r.name} (${r.students.length} students) for this exam.` });
  }
  async function save() {
    if (!roster) return;
    setBusy(true);
    const err = await classes.save(name.trim() || roster.name, section.trim() || undefined, roster).catch(() => "Could not save the class.");
    setBusy(false);
    if (err) { setMsg({ ok: false, text: err }); return; }
    setMsg({ ok: true, text: `Saved to ${where}. Pick it for any exam next time.` });
    setSaving(false);
  }

  return (
    <div className="v-panel w-fit max-w-full space-y-3 p-3 text-sm" data-testid="class-picker">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="saved-class" className="whitespace-nowrap font-medium">Saved classes</label>
        <Select
          id="saved-class"
          name="saved-class"
          value=""
          disabled={busy || !classes.list?.length}
          placeholder={classes.list === undefined ? "Loading…" : classes.list.length ? "Use a saved class for this exam…" : "No saved classes yet"}
          className="w-full min-w-0 sm:w-64"
          options={(classes.list ?? []).map((c) => ({ value: c.id, label: `${c.name}${c.section ? ` · ${c.section}` : ""} (${c.count} students)` }))}
          onChange={(v) => { if (v) void attach(v); }}
        />
        {roster && !saving && <button type="button" className="v-btn min-h-10" data-testid="save-as-class" onClick={() => { setName(roster.name); setSection(""); setSaving(true); setMsg(null); }}>Save this roster as a class</button>}
      </div>
      {saving && roster && (
        <div className="flex flex-wrap items-end gap-2" data-testid="save-class-form">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Class name<input name="class-name" className="v-input mt-1 block w-56" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Section (optional)<input name="class-section" className="v-input mt-1 block w-40" value={section} maxLength={100} onChange={(e) => setSection(e.target.value)} /></label>
          <button type="button" className="v-btn v-btn-primary min-h-10" disabled={busy} onClick={() => void save()} data-testid="save-class-confirm">Save class</button>
          <button type="button" className="v-btn min-h-10" onClick={() => setSaving(false)}>Cancel</button>
        </div>
      )}
      {msg && <p role="status" data-testid="class-message" className={msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>{msg.text}</p>}
      {!!classes.list?.length && (
        <details>
          <summary className="cursor-pointer text-xs text-zinc-500">Manage saved classes ({classes.where === "cloud" ? "kept on your account" : "kept on this device"})</summary>
          <ul className="mt-2 space-y-1">
            {classes.list.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{c.name}{c.section ? ` · ${c.section}` : ""} <span className="text-zinc-500">({c.count})</span></span>
                <button type="button" className="v-btn !px-2.5 !py-1 text-red-700 dark:text-red-300" aria-label={`Remove class ${c.name}`}
                  onClick={async () => { if (!confirm(`Remove the saved class "${c.name}"? Exams that already use it keep their class list.`)) return; const err = await classes.remove(c.id); setMsg(err ? { ok: false, text: err } : { ok: true, text: "Class removed." }); }}>Remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function RosterPanel({ roster, recon, onImport, onOpen, download, classes }: {
  roster: Roster | null;
  recon: Reconciliation;
  onImport: (r: Roster) => void;
  onOpen: (sheetId: string) => void;
  download: (name: string, data: string, type: string) => void;
  /** saved classes (this device or the cloud); omit to hide the picker */
  classes?: ClassesPort;
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
      {classes && <ClassPicker classes={classes} roster={roster} onAttach={onImport} />}
      <div className="v-panel flex flex-wrap items-center gap-2 p-3 text-sm">
        <label className="v-btn v-btn-primary cursor-pointer">
          Import roster CSV<input id="roster-file" name="roster-file" type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <span className="text-zinc-500">{roster ? `${roster.name}: ${roster.students.length} students` : "No roster imported. Columns like Roll No / Student ID / LRN and Name / Full Name are detected automatically."}</span>
        {roster && <button type="button" className="v-btn ml-auto !px-2.5 !py-1" onClick={() => download(`${roster.name}.csv`, rosterToCsv(roster), "text/csv")}>Export roster</button>}
      </div>

      {last && (
        <div className="v-panel p-3 text-sm">
          <p>Imported <b>{last.roster.students.length}</b> students. Columns used: {Object.entries(last.mapping).map(([k, i]) => `${k} ← "${last.headers[i!]}"`).join(", ") || "none"}.</p>
          {last.issues.length > 0 && <ul className="mt-1 list-disc pl-5 text-amber-800 dark:text-amber-300">{last.issues.slice(0, 8).map((i, k) => <li key={k}>{i.message}</li>)}{last.issues.length > 8 && <li>… {last.issues.length - 8} more</li>}</ul>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {([["all", `All (${recon.entries.length})`], ["MATCHED", `Matched ${s.matched}`], ["ABSENT", `Absent ${s.absent}`], ["UNREGISTERED_STUDENT", `Not on roster ${s.unregistered}`], ["UNREADABLE_ROLL", `Unreadable ${s.unreadable}`]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full px-3 py-1 ${filter === k ? "bg-[var(--brand)] text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>{label}</button>
        ))}
        {s.duplicates > 0 && <span className="self-center text-xs text-amber-700">{s.duplicates} student(s) scanned more than once</span>}
      </div>

      <div className="v-panel max-h-[60vh] overflow-auto">
        <table className="v-table min-w-[560px]">
          <thead className="sticky top-0 z-10">
            <tr><th className="px-3 py-2">Status</th><th className="px-3">Roll</th><th className="px-3">Name</th><th className="px-3">Section</th><th className="px-3">Sheets</th></tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const sheets = "sheetIds" in e ? e.sheetIds : [];
              const st = "student" in e ? e.student : null;
              return (
                <tr key={i}>
                  <td className="px-3 py-1.5"><span className={`v-badge !text-[11px] !font-semibold ${BADGE[e.status]}`}>{LABEL[e.status]}</span></td>
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
