"use client";

import { useEffect, useId, useState } from "react";
import type { LayoutSettings, SectionSettings } from "@/lib/omr/schema";

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const labelCls = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

function Field({ label, children, hint }: { label: string; children: (id: string) => React.ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children(id)}
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Parse a draft and clamp it into [min, max]; empty / garbage falls back to `min`. */
export function clampDraft(draft: string, min: number, max: number): number {
  const n = parseInt(draft, 10);
  return Math.min(max, Math.max(min, Number.isNaN(n) ? min : n));
}

/**
 * Integer input with a local text draft, so the box can be cleared and multi-digit numbers typed
 * freely. Valid in-range numbers update the preview live; the value is clamped on blur / Enter.
 */
function NumberInput({ value, min, max, onChange, id, presets }: { value: number; min: number; max: number; onChange: (v: number) => void; id: string; presets?: readonly number[] }) {
  const [draft, setDraft] = useState(String(value));
  // follow external changes (presets, loading a preset layout) unless the draft already means this value
  useEffect(() => { setDraft((d) => (parseInt(d, 10) === value ? d : String(value))); }, [value]);
  const commit = () => { const v = clampDraft(draft, min, max); setDraft(String(v)); if (v !== value) onChange(v); };
  const shown = presets?.filter((p) => p >= min && p <= max);
  return (
    <>
      <input id={id} type="number" inputMode="numeric" className={inputCls} value={draft} min={min} max={max} step={1}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= min && n <= max) onChange(n);     // live preview only for valid numbers
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } }} />
      {shown && shown.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Quick pick">
          {shown.map((p) => (
            <button key={p} type="button" aria-pressed={value === p} onClick={() => { setDraft(String(p)); onChange(p); }}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${value === p ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "border-zinc-300 text-zinc-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400"}`}>{p}</button>
          ))}
        </div>
      )}
    </>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
      <input type="checkbox" className="size-4 accent-indigo-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** standard exam lengths (only those within the section type's limit are shown) */
const QUICK_COUNTS = [20, 30, 50, 60, 100] as const;

let sectionSeq = 0;
const newSectionId = () => `s${Date.now().toString(36)}${(sectionSeq++).toString(36)}`;

function defaultSection(type: SectionSettings["type"]): SectionSettings {
  const id = newSectionId();
  if (type === "numeric") return { id, name: "Numeric", type, questionCount: 2, digits: 4, hasSign: false, hasDecimal: true };
  if (type === "matrix") return { id, name: "Matrix Match", type, questionCount: 1, rows: 4, cols: 4 };
  return { id, name: "", type: "mcq", questionCount: 20, optionCount: 4, optionStyle: "letters" };
}

function SectionCard({ section, index, total, onChange, onRemove, onMove }: {
  section: SectionSettings; index: number; total: number;
  onChange: (s: SectionSettings) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const badge = { mcq: "MCQ", numeric: "Numeric", matrix: "Matrix" }[section.type];
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">{badge}</span>
        <span className="text-xs text-zinc-500">Section {index + 1}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" className="rounded px-1.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move section up">↑</button>
          <button type="button" className="rounded px-1.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move section down">↓</button>
          <button type="button" className="rounded px-1.5 text-zinc-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-500/10" disabled={total === 1} onClick={onRemove} aria-label="Remove section">✕</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Field label="Section name">{(id) => <input id={id} className={inputCls} value={section.name} maxLength={40} placeholder="(optional)" onChange={(e) => onChange({ ...section, name: e.target.value })} />}</Field>
        </div>
        <Field label="Questions">{(id) => <NumberInput id={id} value={section.questionCount} min={1} max={section.type === "mcq" ? 200 : 20} presets={QUICK_COUNTS} onChange={(v) => onChange({ ...section, questionCount: v })} />}</Field>
        {section.type === "mcq" && (
          <>
            <Field label="Options">{(id) => (
              <NumberInput id={id} value={section.optionStyle === "true-false" ? 2 : section.optionCount} min={2} max={10}
                onChange={(v) => onChange({ ...section, optionCount: v, optionStyle: section.optionStyle === "true-false" ? "letters" : section.optionStyle })} />
            )}</Field>
            <div className="col-span-2">
              <Field label="Labels">{(id) => (
                <select id={id} className={inputCls} value={section.optionStyle}
                  onChange={(e) => {
                    const style = e.target.value as typeof section.optionStyle;
                    onChange({ ...section, optionStyle: style, optionCount: style === "true-false" ? 2 : section.optionCount });
                  }}>
                  <option value="letters">A B C D …</option>
                  <option value="numbers">1 2 3 4 …</option>
                  <option value="true-false">True / False</option>
                </select>
              )}</Field>
            </div>
          </>
        )}
        {section.type === "numeric" && (
          <>
            <Field label="Digits">{(id) => <NumberInput id={id} value={section.digits} min={1} max={8} onChange={(v) => onChange({ ...section, digits: v })} />}</Field>
            <div className="col-span-2 flex gap-4">
              <Toggle label="Negative sign" checked={section.hasSign} onChange={(v) => onChange({ ...section, hasSign: v })} />
              <Toggle label="Decimal point" checked={section.hasDecimal} onChange={(v) => onChange({ ...section, hasDecimal: v })} />
            </div>
          </>
        )}
        {section.type === "matrix" && (
          <>
            <Field label="Rows (A…)">{(id) => <NumberInput id={id} value={section.rows} min={2} max={6} onChange={(v) => onChange({ ...section, rows: v })} />}</Field>
            <Field label="Columns (P…)">{(id) => <NumberInput id={id} value={section.cols} min={2} max={6} onChange={(v) => onChange({ ...section, cols: v })} />}</Field>
          </>
        )}
      </div>
    </div>
  );
}

export default function SettingsPanel({ settings, onChange }: { settings: LayoutSettings; onChange: (s: LayoutSettings) => void }) {
  const set = <K extends keyof LayoutSettings>(k: K, v: LayoutSettings[K]) => onChange({ ...settings, [k]: v });
  const setSection = (i: number, sec: SectionSettings) => set("sections", settings.sections.map((s, j) => (j === i ? sec : s)));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Sheet</h2>
        <Field label="Title">{(id) => <input id={id} className={inputCls} value={settings.title} maxLength={80} onChange={(e) => set("title", e.target.value)} />}</Field>
        <Field label="Subtitle">{(id) => <input id={id} className={inputCls} value={settings.subtitle} maxLength={80} onChange={(e) => set("subtitle", e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Paper">{(id) => (
            <select id={id} className={inputCls} value={settings.paper} onChange={(e) => set("paper", e.target.value as LayoutSettings["paper"])}>
              <option value="A4">A4 (210 × 297 mm)</option>
              <option value="LETTER">US Letter</option>
            </select>
          )}</Field>
          <Field label="Answer columns">{(id) => <NumberInput id={id} value={settings.columns} min={1} max={6} onChange={(v) => set("columns", v)} />}</Field>
        </div>
        <Field label={`Bubble diameter · ${settings.bubbleDiameterMm.toFixed(1)} mm`} hint="Row pitch = d + 1.4 mm · reference mark every 5 rows">
          {(id) => (
            <input id={id} type="range" min={3.2} max={6} step={0.1} className="w-full accent-indigo-600" value={settings.bubbleDiameterMm}
              onChange={(e) => set("bubbleDiameterMm", Math.round(Number(e.target.value) * 10) / 10)} />
          )}
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Identity</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Roll number digits" hint="0 = none">{(id) => <NumberInput id={id} value={settings.rollDigits} min={0} max={10} onChange={(v) => set("rollDigits", v)} />}</Field>
          <Field label="First roll row">{(id) => (
            <select id={id} className={inputCls} value={settings.rollStartDigit} onChange={(e) => set("rollStartDigit", Number(e.target.value) as 0 | 1)}>
              <option value={0}>0 1 2 … 9</option>
              <option value={1}>1 2 … 9 0</option>
            </select>
          )}</Field>
          <Field label="Exam sets" hint="0 = no set selector">{(id) => (
            <select id={id} className={inputCls} value={settings.examSets} onChange={(e) => set("examSets", Number(e.target.value))}>
              <option value={0}>None</option>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{"ABCDEF".slice(0, n).split("").join(" / ")}</option>)}
            </select>
          )}</Field>
          <div className="flex items-end pb-2"><Toggle label="Name / class / signature" checked={settings.nameField} onChange={(v) => set("nameField", v)} /></div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Sections</h2>
          <span className="ml-auto text-xs text-zinc-500">{settings.sections.reduce((n, s) => n + s.questionCount, 0)} questions</span>
        </div>
        {settings.sections.map((sec, i) => (
          <SectionCard key={sec.id} section={sec} index={i} total={settings.sections.length}
            onChange={(s) => setSection(i, s)}
            onRemove={() => set("sections", settings.sections.filter((_, j) => j !== i))}
            onMove={(dir) => {
              const next = [...settings.sections];
              [next[i], next[i + dir]] = [next[i + dir], next[i]];
              set("sections", next);
            }} />
        ))}
        <div className="grid grid-cols-3 gap-2">
          {(["mcq", "numeric", "matrix"] as const).map((t) => (
            <button key={t} type="button" onClick={() => set("sections", [...settings.sections, defaultSection(t)])}
              className="rounded-md border border-dashed border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400">
              + {t === "mcq" ? "MCQ" : t === "numeric" ? "Numeric" : "Matrix"}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Template identity</h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Field label="Template ID">{(id) => (
              <input id={id} className={`${inputCls} font-mono text-xs`} value={settings.templateId} maxLength={40}
                onChange={(e) => { const v = e.target.value.replace(/[^A-Za-z0-9_-]/g, ""); if (v) set("templateId", v); }} />
            )}</Field>
          </div>
          <Field label="Version">{(id) => <NumberInput id={id} value={settings.version} min={1} max={9999} onChange={(v) => set("version", v)} />}</Field>
        </div>
      </section>
    </div>
  );
}
