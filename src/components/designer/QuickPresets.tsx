"use client";
/** One-tap sheet sizes for teachers: pick 20 / 50 / 100 items; ID grid and exam sets are included. */
import { useState } from "react";
import { activeQuickPreset, applyQuickPreset, PRESETS, QUICK_PRESETS } from "@/lib/omr/presets";
import type { LayoutSettings } from "@/lib/omr/schema";

export default function QuickPresets({ settings, onApply }: { settings: LayoutSettings; onApply: (s: LayoutSettings) => void }) {
  const active = activeQuickPreset(settings);
  const [more, setMore] = useState(false);
  return (
    <section aria-label="Quick presets" className="space-y-2" data-testid="quick-presets">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Quick presets</h2>
      <div className="grid grid-cols-3 gap-2">
        {QUICK_PRESETS.map((q) => {
          const on = active === q.id;
          return (
            <button key={q.id} type="button" aria-pressed={on} data-testid={`preset-${q.id}`} onClick={() => onApply(applyQuickPreset(settings, q))}
              className={`relative flex flex-col items-center rounded-xl border px-1 py-2.5 text-center transition ${on ? "border-2 border-indigo-600 bg-indigo-50 shadow-sm dark:bg-indigo-500/15" : "border-zinc-300 hover:border-indigo-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"}`}>
              {on && <span aria-hidden className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">✓</span>}
              <span className={`text-2xl font-bold leading-none tabular-nums ${on ? "text-indigo-700 dark:text-indigo-300" : ""}`}>{q.questions}</span>
              <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Items</span>
              <span className="mt-1 text-xs font-medium">{q.tagline}</span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} data-testid="more-templates-toggle"
        className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:border-indigo-400 hover:text-indigo-700 dark:border-zinc-700 dark:text-zinc-300">
        More templates {more ? "▴" : "▾"}
      </button>
      {more && (
        <ul className="space-y-1" data-testid="more-templates">
          {PRESETS.filter((p) => !p.id.startsWith("zg-")).map((p) => (
            <li key={p.id}><button type="button" className="w-full rounded-md border border-zinc-200 px-2 py-1 text-left text-xs hover:border-indigo-400 dark:border-zinc-700"
              onClick={() => onApply({ ...p.settings, templateId: settings.templateId })}>{p.name}</button></li>
          ))}
        </ul>
      )}
    </section>
  );
}
