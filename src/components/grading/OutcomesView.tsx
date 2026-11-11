"use client";
/** Outcomes-Based Education view: course-outcome mastery cards and the program-outcome roll-up. */
import type { AttainmentReport, CoAttainment } from "@/lib/syllabus/attainment";

function Bar({ percent, target, met }: { percent: number | null; target: number; met: boolean | null }) {
  return (
    <div className="relative h-2.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0}>
      {percent !== null && <div className={`h-full rounded-full ${met ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.max(1, percent)}%` }} />}
      <div className="absolute top-[-3px] h-[16px] w-0.5 bg-zinc-900 dark:bg-zinc-100" style={{ left: `${target}%` }} title={`Target ${target}%`} />
    </div>
  );
}

function CoCard({ c, target }: { c: CoAttainment; target: number }) {
  return (
    <div className={`rounded-lg border p-3 ${c.met === false ? "border-red-300 bg-red-50/50 dark:border-red-500/40 dark:bg-red-500/5" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`} data-testid={`co-${c.code}`}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{c.code}</h3>
        <span className={`ml-auto text-xl font-semibold tabular-nums ${c.met === false ? "text-red-600 dark:text-red-400" : c.met ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>{c.percent === null ? "—" : `${c.percent.toFixed(1)}%`}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 min-h-8 text-xs text-zinc-500">{c.description || "Not described in the syllabus"}</p>
      <div className="mt-2"><Bar percent={c.percent} target={target} met={c.met} /></div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span>{c.items} item{c.items === 1 ? "" : "s"}</span>
        <span>{c.earned} / {c.possible} pts</span>
        {c.programOutcomes.length > 0 && <span>PO {c.programOutcomes.join(", ")}</span>}
        {c.met === false && <span className="ml-auto rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">Below {target}% target</span>}
        {c.met === null && <span className="ml-auto rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">Not assessed</span>}
      </div>
    </div>
  );
}

export default function OutcomesView({ report, exporting, onExport, subtitle }: { report: AttainmentReport; exporting: boolean; onExport: () => void; subtitle: string }) {
  const measuredPo = report.programOutcomes.filter((p) => p.percent !== null);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-base font-semibold">Course outcome attainment</h2>
          <p className="text-xs text-zinc-500">{subtitle} · {report.n} student{report.n === 1 ? "" : "s"} · target {report.target}%</p>
        </div>
        <button type="button" disabled={exporting || report.n < 2} onClick={onExport}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          title={report.n < 2 ? "Needs at least 2 graded sheets" : "PDF audit slip: psychometric reliability + outcome attainment"}>
          {exporting ? "Building PDF…" : "Export accreditation report"}
        </button>
      </div>

      {report.belowTarget.length > 0 && (
        <div role="status" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {report.belowTarget.join(", ")} fell below the {report.target}% target. Review how these outcomes were taught and assessed.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {report.courseOutcomes.map((c) => <CoCard key={c.code} c={c} target={report.target} />)}
      </div>
      {report.unmappedItems > 0 && <p className="text-xs text-zinc-500">{report.unmappedItems} question(s) are not mapped to an outcome and are not counted here.</p>}

      <section>
        <h2 className="mb-2 text-base font-semibold">Program outcome roll-up</h2>
        {measuredPo.length === 0 ? <p className="text-sm text-zinc-500">No program outcome is supported by the outcomes this exam measured.</p> : (
          <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {report.programOutcomes.map((p) => (
              <li key={p.code} className={`grid grid-cols-[3rem_minmax(0,1fr)_4rem] items-center gap-2 text-sm ${p.percent === null ? "opacity-50" : ""}`} data-testid={`po-${p.code}`}>
                <b>PO {p.code}</b>
                <div className="min-w-0">
                  <div className="truncate text-xs text-zinc-500" title={p.description}>{p.description || "—"}</div>
                  <Bar percent={p.percent} target={report.target} met={p.met} />
                </div>
                <div className="text-right tabular-nums">{p.percent === null ? "—" : `${p.percent.toFixed(1)}%`}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
