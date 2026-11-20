"use client";
/** Gradebook filter by section. Rendered only when the roster tags students with at least two sections. */

export default function SectionPills({ tags, total, value, onChange }: { tags: { label: string; count: number }[]; total: number; value: string | null; onChange: (label: string | null) => void }) {
  if (tags.length < 2) return null;
  const pill = (active: boolean) => `inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition [@media(pointer:coarse)]:min-h-11 ${active ? "border-[var(--brand-solid)] bg-[var(--brand-solid)] text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:border-[var(--brand-soft)]"}`;
  return (
    <div role="group" aria-label="Filter by section" data-testid="section-pills" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-zinc-500">Section</span>
      <button type="button" aria-pressed={value === null} className={pill(value === null)} onClick={() => onChange(null)}>All <span className="opacity-80">{total}</span></button>
      {tags.map((t) => (
        <button key={t.label} type="button" aria-pressed={value === t.label} data-testid="section-pill" className={pill(value === t.label)} onClick={() => onChange(value === t.label ? null : t.label)}>
          {t.label} <span className="opacity-80">{t.count}</span>
        </button>
      ))}
    </div>
  );
}
