"use client";
/** ZipGrade-style one-click forms: pick a length, get a print-ready sheet (5-digit ID, sets A/B/C/D). */
import { activeQuickPreset, applyQuickPreset, PRESETS, QUICK_PRESETS } from "@/lib/omr/presets";
import type { LayoutSettings } from "@/lib/omr/schema";

export default function QuickPresets({ settings, onApply }: { settings: LayoutSettings; onApply: (s: LayoutSettings) => void }) {
  const active = activeQuickPreset(settings);
  return (
    <section aria-label="Quick presets" className="space-y-2" data-testid="quick-presets">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Quick presets</h2>
      <div className="grid gap-1.5">
        {QUICK_PRESETS.map((q) => {
          const on = active === q.id;
          return (
            <button key={q.id} type="button" aria-pressed={on} data-testid={`preset-${q.id}`} onClick={() => onApply(applyQuickPreset(settings, q))}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${on ? "border-indigo-500 bg-indigo-50 text-indigo-800 shadow-[inset_3px_0_0_var(--gold)] dark:bg-indigo-500/15 dark:text-indigo-200" : "border-zinc-300 hover:border-indigo-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"}`}>
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-indigo-600 text-xs font-bold text-white tabular-nums">{q.questions}</span>
              <span className="min-w-0"><span className="block font-medium">{q.label}</span><span className="block text-[11px] text-zinc-500">A–D · 5-digit Student ID · Sets A/B/C/D · {q.settings.columns} columns</span></span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-500">One tap configures the sheet; then click <b>Download Answer Sheet (PDF)</b>.</p>
      <details className="text-xs" data-testid="more-templates">
        <summary className="cursor-pointer text-indigo-600 hover:underline">More templates…</summary>
        <ul className="mt-1.5 space-y-1">
          {PRESETS.filter((p) => !p.id.startsWith("zg-")).map((p) => (
            <li key={p.id}><button type="button" className="w-full rounded-md border border-zinc-200 px-2 py-1 text-left hover:border-indigo-400 dark:border-zinc-700"
              onClick={() => onApply({ ...p.settings, templateId: settings.templateId })}>{p.name}</button></li>
          ))}
        </ul>
      </details>
    </section>
  );
}
