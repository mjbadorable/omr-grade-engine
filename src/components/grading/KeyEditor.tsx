"use client";

import { memo, useState } from "react";
import { formatSetMappingText, parseSetMappingText, updateAllRules, updateKey, updateRule } from "@/lib/grading/answer-key";
import type { AnswerKey, ItemStatistics, MatchMode, QuestionRule } from "@/lib/grading/types";
import { gridRows, keyedCount, toggleRowBubble } from "@/lib/grading/key-grid";
import { QualityDot } from "./QualityBadge";

const input = "rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm tabular-nums outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900";
const num = (v: string, fallback: number) => (v.trim() === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

const RuleRow = memo(function RuleRow({ rule, stat, onChange }: { rule: QuestionRule; stat?: ItemStatistics; onChange: (patch: Partial<QuestionRule>) => void }) {
  const dim = rule.dropped ? "opacity-40" : "";
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800">
      <td className="py-1 pr-2 text-right font-mono text-xs text-zinc-500">{rule.questionNumber}</td>
      <td className={`py-1 pr-3 ${dim}`}>
        {rule.type === "choice" ? (
          <div className="flex gap-1" role="group" aria-label={`Correct options for question ${rule.questionNumber}`}>
            {rule.optionLabels.map((l, i) => {
              const on = rule.correct.includes(i);
              return (
                <button key={l} type="button" aria-pressed={on}
                  onClick={() => onChange({ correct: on ? rule.correct.filter((x) => x !== i) : [...rule.correct, i].sort((a, b) => a - b) } as Partial<QuestionRule>)}
                  className={`size-7 rounded-full border text-xs font-semibold transition ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 text-zinc-500 hover:border-emerald-500 dark:border-zinc-600"}`}>
                  {l}
                </button>
              );
            })}
          </div>
        ) : rule.type === "numeric" ? (
          <div className="flex items-center gap-1 text-xs">
            <input key={`v${rule.value}`} aria-label="Correct value" className={`${input} w-20`} defaultValue={rule.value ?? ""} placeholder="value"
              onBlur={(e) => onChange({ value: e.target.value.trim() === "" ? null : num(e.target.value, rule.value ?? 0) } as Partial<QuestionRule>)} />
            ±<input key={`t${rule.tolerance}`} aria-label="Tolerance" className={`${input} w-14`} defaultValue={rule.tolerance} onBlur={(e) => onChange({ tolerance: Math.max(0, num(e.target.value, 0)) } as Partial<QuestionRule>)} />
          </div>
        ) : (
          <div className="flex flex-wrap gap-1 text-xs">
            {Object.entries(rule.rows).map(([row, cols]) => (
              <label key={row} className="flex items-center gap-0.5">
                <span className="font-semibold">{row}→</span>
                <input key={cols.join("")} className={`${input} w-12 uppercase`} defaultValue={cols.join("")}
                  onBlur={(e) => onChange({ rows: { ...rule.rows, [row]: [...new Set(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))] } } as Partial<QuestionRule>)} />
              </label>
            ))}
          </div>
        )}
      </td>
      <td className={`py-1 pr-2 ${dim}`}>
        {rule.type !== "numeric" && (
          <select aria-label="Match mode" className={`${input} text-xs`} value={rule.mode} onChange={(e) => onChange({ mode: e.target.value as MatchMode } as Partial<QuestionRule>)}>
            <option value="ALL_MATCH">All match</option>
            {rule.type === "choice" && <option value="ANY_MATCH">Any match</option>}
            <option value="PARTIAL_CREDIT">Partial credit</option>
          </select>
        )}
      </td>
      <td className="py-1 pr-1"><input aria-label="Points" className={`${input} w-12`} type="number" min={0} step={0.25} value={rule.points} onChange={(e) => onChange({ points: Math.max(0, num(e.target.value, rule.points)) })} /></td>
      <td className="py-1 pr-2"><input aria-label="Negative marks" className={`${input} w-12`} type="number" min={0} step={0.25} value={rule.negative} onChange={(e) => onChange({ negative: Math.max(0, num(e.target.value, rule.negative)) })} /></td>
      <td className="py-1 pr-2 text-center"><input aria-label="Bonus" type="checkbox" className="accent-emerald-600" checked={rule.bonus} onChange={(e) => onChange({ bonus: e.target.checked })} /></td>
      <td className="py-1 pr-2 text-center"><input aria-label="Drop question" type="checkbox" className="accent-red-600" checked={rule.dropped} onChange={(e) => onChange({ dropped: e.target.checked })} /></td>
      <td className="py-1 pr-2"><input key={rule.tags.subject ?? ""} aria-label="Subject" className={`${input} w-24 text-xs`} defaultValue={rule.tags.subject ?? ""} placeholder="subject" onBlur={(e) => onChange({ tags: { ...rule.tags, subject: e.target.value.trim() || undefined } })} /></td>
      <td className="py-1 text-xs tabular-nums text-zinc-500">{stat ? <span className="inline-flex items-center gap-1.5"><QualityDot quality={stat.quality} />p {stat.p.toFixed(2)} · D {stat.d.toFixed(2)}</span> : "—"}</td>
    </tr>
  );
});

export default function KeyEditor({ answerKey, onChange, stats, keySources }: {
  answerKey: AnswerKey;
  onChange: (k: AnswerKey) => void;
  stats: Map<number, ItemStatistics>;
  keySources: { id: string; label: string; apply: () => void }[];
}) {
  const [allPts, setAllPts] = useState("4");
  const [allNeg, setAllNeg] = useState("1");
  const [bands, setBands] = useState(() => answerKey.gradeBands.map((b) => `${b.label}≥${b.minPercent}`).join(", "));
  const rules = [...answerKey.questions.values()];
  const setLabels = Object.keys(answerKey.sets);
  const [view, setView] = useState<"grid" | "table">("grid");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <label className="flex items-center gap-1">All questions: +<input className={`${input} w-14`} value={allPts} onChange={(e) => setAllPts(e.target.value)} aria-label="Points for all" />
          −<input className={`${input} w-14`} value={allNeg} onChange={(e) => setAllNeg(e.target.value)} aria-label="Negative for all" /></label>
        <button type="button" className="rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          onClick={() => onChange(updateAllRules(answerKey, { points: Math.max(0, num(allPts, 1)), negative: Math.max(0, num(allNeg, 0)) }))}>Apply</button>
        <label className="flex items-center gap-1">Uncertain marks:
          <select className={input} value={answerKey.conflictPolicy} onChange={(e) => onChange(updateKey(answerKey, { conflictPolicy: e.target.value as AnswerKey["conflictPolicy"] }))}>
            <option value="zero">hold for review (0 pts)</option>
            <option value="score-filled">score filled bubbles</option>
          </select>
        </label>
        <label className="flex min-w-[260px] flex-1 items-center gap-1">Grades:
          <input className={`${input} flex-1`} value={bands} onChange={(e) => setBands(e.target.value)} aria-label="Grade bands"
            onBlur={() => {
              const parsed = bands.split(",").map((x) => /^\s*([^≥>]+?)\s*(?:≥|>=)\s*(\d+(?:\.\d+)?)\s*$/.exec(x)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ label: m[1], minPercent: Number(m[2]) }));
              if (parsed.length) onChange(updateKey(answerKey, { gradeBands: parsed }));
            }} />
        </label>
        {keySources.length > 0 && (
          <select className={input} value="" aria-label="Take key from a scanned sheet" onChange={(e) => keySources.find((s) => s.id === e.target.value)?.apply()}>
            <option value="" disabled>Use a scanned sheet as key…</option>
            {keySources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>

      {setLabels.length > 1 && <SetMappings answerKey={answerKey} onChange={onChange} />}

      <div className="flex items-center gap-2 text-sm" role="tablist" aria-label="Key editor view">
        {([["grid", "Bubble grid"], ["table", "Detailed table"]] as const).map(([v, label]) => (
          <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 ${view === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>{label}</button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">{keyedCount(answerKey)} of {rules.filter((r) => r.type === "choice").length} choice questions keyed</span>
      </div>

      {view === "grid" && <BubbleGrid answerKey={answerKey} onChange={onChange} />}

      <div className={`overflow-x-auto rounded-lg border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950 ${view === "grid" ? "hidden" : ""}`}>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="py-2 pr-2 text-right">Q</th><th>Correct answer</th><th>Mode</th><th>+</th><th>−</th><th className="text-center">Bonus</th><th className="text-center">Drop</th><th>Subject</th><th>Live stats</th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <RuleRow key={r.questionNumber} rule={r} stat={stats.get(r.questionNumber)} onChange={(patch) => onChange(updateRule(answerKey, r.questionNumber, patch))} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ZipGrade-style "Edit Key": click bubbles per question, per exam set. Several bubbles = alternate credit. */
function BubbleGrid({ answerKey, onChange }: { answerKey: AnswerKey; onChange: (k: AnswerKey) => void }) {
  const sets = Object.keys(answerKey.sets);
  const [active, setActive] = useState<string | null>(answerKey.defaultSet ?? sets[0] ?? null);
  const set = active && sets.includes(active) ? active : sets[0] ?? null;
  const rows = gridRows(answerKey, set);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950" data-testid="bubble-grid">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {sets.length > 1 && (
          <div className="flex gap-1" role="tablist" aria-label="Exam set">
            {sets.map((l) => (
              <button key={l} role="tab" type="button" aria-selected={l === set} onClick={() => setActive(l)}
                className={`rounded-md border px-3 py-1 text-sm font-semibold ${l === set ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 text-zinc-600 hover:border-indigo-400 dark:border-zinc-700 dark:text-zinc-300"}`}>Set {l}</button>
            ))}
          </div>
        )}
        <p className="text-xs text-zinc-500">Click a bubble to set the answer. Mark <b>two or more</b> for alternate credit (any one earns full points). <span title="Bonus: every student gets full credit">★</span> gives everyone full credit. Every change rescores all papers instantly.</p>
      </div>
      <div className="gap-x-8 sm:columns-2 2xl:columns-4">
        {rows.map((row) => {
          const rule = answerKey.questions.get(row.master)!;
          const dim = rule.dropped ? "opacity-40" : "";
          return (
            <div key={row.master} className={`mb-1.5 flex break-inside-avoid items-center gap-2 ${dim}`} data-testid={`key-row-${row.printed}`}>
              <span className="w-7 shrink-0 text-right font-mono text-xs text-zinc-500">{row.printed}</span>
              {row.rule ? (
                <div className="flex gap-1" role="group" aria-label={`Correct answer for question ${row.printed}`}>
                  {row.rule.optionLabels.map((_, p) => {
                    const m = row.perm[p];
                    const on = row.rule!.correct.includes(m);
                    return (
                      <button key={p} type="button" aria-pressed={on} aria-label={`${row.rule!.optionLabels[p]}`} onClick={() => { const patch = toggleRowBubble(row, p); if (patch) onChange(updateRule(answerKey, row.master, patch)); }}
                        className={`size-7 rounded-full border text-xs font-semibold transition ${on ? "border-emerald-600 bg-emerald-600 text-white shadow-sm" : "border-zinc-300 text-zinc-500 hover:border-emerald-500 hover:text-emerald-700 dark:border-zinc-600"}`}>
                        {row.rule!.optionLabels[p]}
                      </button>
                    );
                  })}
                  <button type="button" aria-pressed={rule.bonus} aria-label={`Bonus: full credit to all for question ${row.printed}`} title="Bonus: full credit to everyone" onClick={() => onChange(updateRule(answerKey, row.master, { bonus: !rule.bonus }))}
                    className={`ml-1 size-7 rounded-md border text-sm transition ${rule.bonus ? "border-gold bg-gold-tint text-gold-hover dark:text-gold" : "border-transparent text-zinc-300 hover:border-zinc-300 hover:text-zinc-500 dark:text-zinc-600"}`}>★</button>
                  {row.rule.correct.length > 1 && <span className="self-center rounded bg-sky-100 px-1 text-[10px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" title="Alternate credit: any marked option earns full points">any</span>}
                </div>
              ) : <span className="text-xs text-zinc-400">{rule.type} question: edit in the detailed table</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SetMappings({ answerKey, onChange }: { answerKey: AnswerKey; onChange: (k: AnswerKey) => void }) {
  const labels = Object.keys(answerKey.sets);
  const [active, setActive] = useState(labels[1] ?? labels[0]);
  const [text, setText] = useState(() => formatSetMappingText(answerKey.sets[active] ?? {}));
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer font-medium">Exam sets &amp; shuffles <span className="font-normal text-zinc-500">(the key is written in Set {answerKey.defaultSet ?? labels[0]} order)</span></summary>
      <div className="mt-3 flex flex-wrap gap-1">
        {labels.map((l) => (
          <button key={l} type="button" onClick={() => { setActive(l); setText(formatSetMappingText(answerKey.sets[l] ?? {})); setErrors([]); }}
            className={`rounded-md px-2.5 py-1 ${l === active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>Set {l}</button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">One line per printed question: <code>printed:master[:SHUFFLE]</code>, e.g. <code>1:7:CABD</code> = printed Q1 is master Q7 and its printed A,B,C,D are master C,A,B,D. Empty = same as the key.</p>
      <textarea className={`${input} mt-2 h-32 w-full font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Mapping for set ${active}`} />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="rounded-md bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700"
          onClick={() => {
            const { mapping, errors: errs } = parseSetMappingText(text, answerKey);
            setErrors(errs);
            if (!errs.length) onChange(updateKey(answerKey, { sets: { ...answerKey.sets, [active]: mapping } }));
          }}>Save Set {active}</button>
        {errors.length > 0 && <span className="text-xs text-red-600">{errors.slice(0, 3).join("; ")}</span>}
      </div>
    </details>
  );
}
