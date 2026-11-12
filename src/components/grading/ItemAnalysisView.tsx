"use client";

import { Fragment, useState } from "react";
import type { PsychometricReport } from "@/lib/grading/types";
import { distributionRows, HIGH_DISTRACTOR, type DistLevel } from "@/lib/grading/item-distribution";
import QualityBadge from "./QualityBadge";

const fmt = (v: number | null, d = 2) => (v === null ? "—" : v.toFixed(d));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950" title={hint}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const FLAG_TEXT: Record<string, string> = {
  POSSIBLE_MISKEY: "possible miskey",
  NEGATIVE_DISCRIMINATION: "negative discrimination",
  LOW_DISCRIMINATION: "D < 0.20",
  TOO_EASY: "too easy",
  TOO_HARD: "too hard",
};

export default function ItemAnalysisView({ report, outcomes }: { report: PsychometricReport; /** question → course outcome code (from the syllabus TOS) */ outcomes?: ReadonlyMap<number, string> }) {
  const [view, setView] = useState<"dist" | "table">("dist");
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "POOR">("all");
  const items = filter === "all" ? report.items : report.items.filter((i) => i.quality === "POOR");
  const kr = report.kr20;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Students" value={String(report.n)} />
        <Stat label="Scored items (K)" value={String(report.k)} />
        <Stat label="Mean ± SD" value={`${fmt(report.mean, 1)} ± ${fmt(report.sd, 1)}`} />
        <Stat label="Median (min–max)" value={`${fmt(report.median, 1)} (${report.min}–${report.max})`} />
        <Stat label="KR-20 reliability" value={fmt(kr)} hint="≥ 0.80 good for classroom tests; ≥ 0.90 for high stakes" />
        <Stat label="SEM (items)" value={fmt(report.sem)} hint="Standard error of measurement on the number-correct scale" />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-500">Show</span>
        {(["all", "POOR"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
            {f === "all" ? `All (${report.items.length})` : `Needs attention (${report.items.filter((i) => i.quality === "POOR").length})`}
          </button>
        ))}
        <span className="ml-2 border-l border-zinc-200 pl-3 dark:border-zinc-700" />
        {([["dist", "Distribution"], ["table", "Table"]] as const).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 ${view === v ? "bg-indigo-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>{label}</button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">Upper/lower groups: top and bottom 27 % ({report.groupSize} students each)</span>
      </div>

      {view === "dist" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="distribution-grid">
          {items.map((i) => <DistributionCard key={i.questionNumber} item={i} co={outcomes?.get(i.questionNumber)} />)}
        </div>
      )}

      <div className={`overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${view === "dist" ? "hidden" : ""}`}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2">Q</th><th>Quality</th>
              <th title="Difficulty: share answering correctly">p</th>
              <th title="Discrimination: p(upper 27 %) − p(lower 27 %)">D</th>
              <th title="Point-biserial with the rest score">r<sub>pbis</sub></th>
              <th>Omitted</th><th>Flags</th><th />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <Fragment key={i.questionNumber}>
                <tr className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900" onClick={() => setOpen(open === i.questionNumber ? null : i.questionNumber)}>
                  <td className="px-3 py-1.5 font-mono">{i.questionNumber}</td>
                  <td><QualityBadge quality={i.quality} miskey={i.flags.includes("POSSIBLE_MISKEY")} /></td>
                  <td className="tabular-nums">{i.p.toFixed(2)}</td>
                  <td className={`tabular-nums ${i.d < 0.2 ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>{i.d.toFixed(2)}</td>
                  <td className="tabular-nums">{fmt(i.rpbisCorrected)}</td>
                  <td className="tabular-nums">{i.omitted}</td>
                  <td className="text-xs text-zinc-600 dark:text-zinc-400">{i.flags.map((f) => FLAG_TEXT[f]).join(", ")}</td>
                  <td className="pr-3 text-right text-zinc-400">{i.distractors.length ? (open === i.questionNumber ? "▾" : "▸") : ""}</td>
                </tr>
                {open === i.questionNumber && i.distractors.length > 0 && (
                  <tr className="border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
                    <td colSpan={8} className="px-4 py-3"><DistractorChart item={i} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DistractorChart({ item }: { item: PsychometricReport["items"][number] }) {
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-indigo-500" />Upper 27 %</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-amber-500" />Lower 27 %</span>
        <span>A good key is chosen far more by the upper group; a good distractor attracts the lower group.</span>
      </div>
      <div className="space-y-1.5">
        {item.distractors.map((d) => (
          <div key={d.optionIndex} className="grid grid-cols-[3rem_1fr_9rem] items-center gap-3 text-xs">
            <span className={`font-semibold ${d.isKey ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{d.label}{d.isKey ? " ✓" : ""}</span>
            <div className="space-y-0.5" role="img" aria-label={`Option ${d.label}: upper ${Math.round(d.upperProportion * 100)}%, lower ${Math.round(d.lowerProportion * 100)}%`}>
              <div className="h-2.5 rounded-sm bg-indigo-500" style={{ width: `${Math.max(1, d.upperProportion * 100)}%` }} />
              <div className="h-2.5 rounded-sm bg-amber-500" style={{ width: `${Math.max(1, d.lowerProportion * 100)}%` }} />
            </div>
            <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
              {Math.round(d.proportion * 100)}% overall{d.flag ? <span className="ml-1 font-semibold text-red-600 dark:text-red-400">{d.flag === "MISLEADING" ? "misleading" : "unused"}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const BAR: Record<DistLevel, string> = { key: "bg-emerald-500", ok: "bg-zinc-400 dark:bg-zinc-500", warn: "bg-amber-500", high: "bg-red-500", blank: "bg-zinc-300 dark:bg-zinc-700" };

/** Who chose what: counts and shares for each option and Blank; key in green, popular wrong options in amber / red. */
function DistributionCard({ item, co }: { item: PsychometricReport["items"][number]; co?: string }) {
  const rows = distributionRows(item);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950" data-testid={`dist-${item.questionNumber}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-sm font-semibold">Q{item.questionNumber}</span>
        {co && <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300" title="Course outcome measured by this question">{co}</span>}
        <QualityBadge quality={item.quality} miskey={item.flags.includes("POSSIBLE_MISKEY")} />
        <span className="ml-auto tabular-nums text-zinc-500" title="Discrimination index D = p(upper 27 %) − p(lower 27 %)">D <b className={item.d < 0.2 ? "text-red-600 dark:text-red-400" : "text-zinc-800 dark:text-zinc-200"}>{item.d.toFixed(2)}</b> · p {item.p.toFixed(2)}</span>
      </div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[2.6rem_1fr_5.5rem] items-center gap-2 text-xs" data-level={r.level}>
            <span className={`font-semibold ${r.isKey ? "text-emerald-700 dark:text-emerald-400" : r.level === "warn" ? "text-amber-700 dark:text-amber-400" : r.level === "high" ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>{r.label}{r.isKey ? " ✓" : ""}</span>
            <div className="h-3 overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-900" role="img" aria-label={`${r.label}: ${r.count} students, ${Math.round(r.pct * 100)} percent`}>
              <div className={`h-full ${BAR[r.level]}`} style={{ width: `${Math.max(r.count ? 2 : 0, r.pct * 100)}%` }} />
            </div>
            <span className="text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.count} · {Math.round(r.pct * 100)}%</span>
          </li>
        ))}
      </ul>
      {rows.some((r) => r.level === "warn" || r.level === "high") && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">A wrong option above {Math.round(HIGH_DISTRACTOR * 100)}% may signal a miskey or a misleading item.</p>}
    </div>
  );
}
