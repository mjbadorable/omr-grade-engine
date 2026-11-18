"use client";
/**
 * Syllabus Breakdown & TOS Organizer (two panes): a compact sidebar (course overview + course outcomes)
 * and a wide workspace (PRELIM / MIDTERM / FINALS tabs, module cards, exam banner, Table of Specifications).
 * Renders a SyllabusBreakdown only, so every syllabus format (rich COB/COC or plain CLASE) looks the same.
 */
import { useState, type ReactNode } from "react";
import type { BreakdownModule, BreakdownTerm, SyllabusBreakdown } from "@/lib/syllabus/breakdown";
import type { Tos } from "@/lib/syllabus/tos";
import type { ExamPeriod, ModuleMode } from "@/lib/syllabus/types";

const hoursText = (h: number) => `${h % 1 === 0 ? h : h.toFixed(1)} ${h === 1 ? "hour" : "hours"}`;
const touch = "min-h-9 [@media(pointer:coarse)]:min-h-11";
const eyebrow = "text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]";
/** Solid crimson pill (white text, ~9:1 in both themes). */
const crimson = "inline-flex items-center rounded-full bg-[var(--brand-solid)] px-2.5 py-0.5 text-xs font-semibold text-white";
/** Gold pill; the text is darkened in light mode so 11px labels keep 4.5:1 on the gold tint. */
const gold = "inline-flex items-center gap-1 rounded-full bg-[var(--gold-tint)] px-2 py-0.5 text-[11px] font-semibold text-[color-mix(in_srgb,var(--gold-hover)_45%,black)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--gold)_45%,transparent)] dark:text-[var(--gold)]";
/** Gold pill on the solid crimson exam bar. */
const goldOnCrimson = "inline-flex items-center gap-1 rounded-full bg-[var(--gold)] px-2.5 py-0.5 text-xs font-semibold text-black";

const ICONS: Record<string, ReactNode> = {
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h13M8 7h7" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></>,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  calendar: <path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 5h16M8 3v4m8-4v4" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  clipboard: <path d="M9 4h6v3H9V4Zm-2 1H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M9 12h6m-6 4h4" />,
  monitor: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm5 15h6m-3-3v3" />,
  flask: <path d="M9 3h6m-5 0v6l-5 9a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 18l-5-9V3M7.5 15h9" />,
  doc: <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v4h4M9 12h6m-6 4h6" />,
  building: <path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 9h3a1 1 0 0 1 1 1v11M3 21h18M9 8h2m-2 4h2m-2 4h2" />,
  users: <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-3A3.5 3.5 0 0 0 6 18.5V20M11 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm9 9v-1a3 3 0 0 0-2-2.8M16 5.2a3 3 0 0 1 0 5.6" />,
  cap: <path d="m12 4 10 5-10 5L2 9l10-5Zm5 7v5c0 1.5-2.2 3-5 3s-5-1.5-5-3v-5" />,
  level: <path d="M4 20h4v-5h4v-5h4V5h4" />,
  hash: <path d="M5 9h14M5 15h14M10 4 8 20m8-16-2 16" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
};
function Icon({ name, className = "size-4" }: { name: keyof typeof ICONS; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[name]}</svg>;
}

/** "LO 1.1 – LO 1.6" for a heading; empty when there are none. */
const loRange = (los: { code: string }[]) => (los.length === 0 ? "" : los.length === 1 ? ` (${los[0].code})` : ` (${los[0].code} – ${los[los.length - 1].code})`);

export interface OrganizerProps {
  fileName: string;
  warnings: string[];
  breakdown: SyllabusBreakdown;
  period: ExamPeriod;
  onPeriod: (p: ExamPeriod) => void;
  tos: Tos;
  onTotal: (n: number) => void;
  onSlide: (moduleNumber: number, questions: number) => void;
  cumulative: boolean;
  onCumulative: (v: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}

// ------------------------------------------------------------------ left sidebar

function SectionHeader({ icon, title }: { icon: keyof typeof ICONS; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--gold-tint)] px-4 py-2.5">
      <Icon name={icon} className="size-4 text-[var(--brand)]" />
      <h3 className="text-[11px] font-bold uppercase tracking-wider">{title}</h3>
    </div>
  );
}

function Sidebar({ b }: { b: SyllabusBreakdown }) {
  const o = b.overview;
  const programRedundant = !!o.program && [o.college, o.department].some((v) => v?.toLowerCase().includes(o.program!.toLowerCase()));
  const facts: [keyof typeof ICONS, string, string | undefined][] = [
    ["building", "College", o.college], ["users", "Department", o.department],
    ["cap", "Program", programRedundant ? undefined : o.program], ["level", "Course level", o.courseLevel], ["hash", "Credit units", o.creditUnits],
  ];
  return (
    <aside className="v-panel min-w-0 self-start overflow-hidden !p-0" data-testid="syllabus-overview">
      <section aria-label="Course overview">
        <SectionHeader icon="book" title="Course overview" />
        <div className="space-y-3 p-4">
          <div>
            <h2 className="text-base font-bold leading-snug">{o.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`${crimson} v-mono`} data-testid="overview-code">{o.code}</span>
              {o.term && <span className="text-xs text-[var(--muted)]">{o.term}</span>}
            </div>
          </div>
          {facts.some(([, , v]) => v) && (
            <dl className="space-y-2 text-sm">
              {facts.filter(([, , v]) => v).map(([icon, k, v]) => (
                <div key={k} className="grid grid-cols-[1rem_5.5rem_minmax(0,1fr)] items-start gap-x-2">
                  <Icon name={icon} className="mt-0.5 size-4 text-[var(--muted)]" />
                  <dt className="text-xs leading-5 text-[var(--muted)]">{k}</dt>
                  <dd className="font-medium leading-5">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <details className="group rounded-lg border border-[var(--border)]" data-testid="overview-pos">
            <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${touch}`}>
              <span>Program Outcomes &amp; AGA Alignment ({b.programOutcomes.total})</span>
              <Icon name="chevron" className="size-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 border-t border-[var(--border)] px-3 py-3 text-xs">
              <div>
                <p className={eyebrow}>Program outcomes ({b.programOutcomes.total})</p>
                {b.programOutcomes.total === 0 ? <p className="mt-1 text-[var(--muted)]">None found in this syllabus.</p> : (
                  <ul className="mt-1 space-y-1">{b.programOutcomes.items.map((p) => <li key={p.code}><b className="v-mono">PO {p.code}</b> {p.description}</li>)}</ul>
                )}
              </div>
              {b.graduateAttributes.length > 0 && (
                <div>
                  <p className={eyebrow}>Augustinian graduate attributes ({b.graduateAttributes.length})</p>
                  <ul className="mt-1 space-y-1">{b.graduateAttributes.map((g) => <li key={g.code}><b className="v-mono">AGA {g.code}</b> {g.description}</li>)}</ul>
                </div>
              )}
            </div>
          </details>
        </div>
      </section>

      <section aria-label="Course outcomes" className="border-t border-[var(--border)]">
        <SectionHeader icon="target" title="Course outcomes" />
        <div className="p-4">
          {b.courseOutcomes.length === 0 && <p className="text-sm text-[var(--muted)]">No course outcomes were found.</p>}
          <ol className="space-y-2">
            {b.courseOutcomes.map((c) => {
              const links = [c.programOutcomes.length ? `PO ${c.programOutcomes.join(" ")}` : "", c.agaLinks.length ? `AGA ${c.agaLinks.join(" ")}` : ""].filter(Boolean).join(" · ");
              return (
                <li key={c.code} data-testid={`co-card-${c.code}`} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex items-start gap-2.5">
                    <span className={`${crimson} v-mono mt-0.5`}>{c.code}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{c.description}</p>
                      {links && <p className="v-mono mt-1 text-[11px] text-[var(--muted)]" title="Program outcomes and Augustinian graduate attributes this outcome supports">{links}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </aside>
  );
}

// ------------------------------------------------------------------ right workspace

function ModeCard({ kind, mode, testId }: { kind: "LECTURE" | "LAB"; mode: ModuleMode; testId: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)]" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 bg-[var(--gold-tint)] px-3 py-1.5">
        <h5 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"><Icon name={kind === "LAB" ? "flask" : "monitor"} className="size-3.5 text-[var(--brand)]" />{kind}</h5>
        {mode.hours !== undefined && <span className={gold}><Icon name="clock" className="size-3" />{hoursText(mode.hours)}</span>}
      </div>
      <div className="grid grid-cols-2 divide-x divide-[var(--border)] text-xs">
        <ul className="list-disc space-y-1 py-2 pl-6 pr-2 marker:text-[var(--muted)]">{mode.tla.map((t) => <li key={t}>{t}</li>)}</ul>
        <ul className="space-y-1 px-2 py-2">
          {mode.assessments.map((t) => (<li key={t} className="flex items-start gap-1.5"><Icon name="doc" className="mt-0.5 size-3.5 text-[var(--muted)]" /><span className="min-w-0">{t}</span></li>))}
        </ul>
      </div>
    </div>
  );
}

function LearningOutcomes({ m, columns }: { m: BreakdownModule; columns?: boolean }) {
  return (
    <div className="min-w-0 p-4">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Icon name="layers" className="size-4 text-[var(--brand)]" />Learning Outcomes{loRange(m.learningOutcomes)}</h4>
      {m.learningOutcomes.length === 0 ? <p className="text-xs text-[var(--muted)]">No learning outcomes listed.</p> : (
        <ul className={`gap-x-6 gap-y-1.5 text-sm ${columns ? "grid grid-cols-1 md:grid-cols-2" : "space-y-1.5"}`}>
          {m.learningOutcomes.map((l, i) => (<li key={`${l.code}-${i}`} className="flex gap-1.5"><span aria-hidden>•</span><span><b className="v-mono mr-1 text-xs">{l.code}</b>{l.description}</span></li>))}
        </ul>
      )}
    </div>
  );
}

function ModuleCard({ m, open, onToggle }: { m: BreakdownModule; open: boolean; onToggle: () => void }) {
  const orientation = m.kind === "orientation";
  const id = `module-body-${m.number}`;
  return (
    <li data-testid={`module-card-${m.label}`} data-kind={m.kind} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className={`flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3 text-left ${touch}`}>
        <span className={`${crimson} v-mono`}>{m.label}</span>
        <span className="min-w-[9rem] flex-1 text-sm font-bold leading-snug">{m.title}</span>
        {orientation && <span className={gold} data-testid="module-orientation-badge">Orientation</span>}
        <Icon name="chevron" className={`size-4 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id} className="border-t border-[color-mix(in_srgb,var(--gold)_55%,var(--border))]">
          {orientation ? (
            <>
              <LearningOutcomes m={m} columns />
              {m.lecture && m.lecture.tla.length > 0 && <p className="border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]"><b className="text-[var(--fg)]">Activities:</b> {m.lecture.tla.join("; ")}</p>}
            </>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-[var(--border)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.15fr)] lg:divide-x lg:divide-y-0">
              <div className="min-w-0 p-4">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Icon name="book" className="size-4 text-[var(--brand)]" />Topics</h4>
                {m.topics.length ? <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-[var(--muted)]">{m.topics.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="text-xs text-[var(--muted)]">No topics listed.</p>}
                {m.courseOutcomes.length > 0 && <p className="mt-3 text-[11px] text-[var(--muted)]">Supports <span className="v-mono font-semibold text-[var(--fg)]">{m.courseOutcomes.join(" · ")}</span></p>}
              </div>
              <LearningOutcomes m={m} />
              <div className="min-w-0 space-y-3 p-4">
                {m.lecture && <ModeCard kind="LECTURE" mode={m.lecture} testId="mode-lecture" />}
                {m.lab && <ModeCard kind="LAB" mode={m.lab} testId="mode-laboratory" />}
                {!m.lecture && !m.lab && <p className="text-xs text-[var(--muted)]">No lecture or laboratory details listed.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ExamBanner({ term }: { term: BreakdownTerm }) {
  const e = term.exam;
  if (!e) return null;
  return (
    <div data-testid="exam-banner" className="rounded-xl bg-[var(--brand-solid)] px-5 py-3 text-white ring-1 ring-inset ring-white/10">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider"><Icon name="clipboard" className="size-4" />{e.title}</p>
        {e.hours !== undefined && <span className={`${goldOnCrimson} sm:mx-auto`}><Icon name="clock" className="size-3.5" />{hoursText(e.hours)}</span>}
        {e.coverageText && <p className="text-xs sm:ml-auto">Coverage: <b className="v-mono">{e.coverageText}</b>{e.derived ? " (this term's modules)" : ""}</p>}
      </div>
      {e.bar.length > 0 && (
        <div role="img" aria-label={`${e.title} covers ${e.coverageText || "no modules"}`} data-testid="exam-coverage" className="mt-3 flex gap-1">
          {e.bar.map((s) => (
            <div key={s.number} className="min-w-0 flex-1" data-covered={s.covered}>
              <div className={`h-1.5 rounded-full ${s.covered ? "bg-[var(--gold)]" : "bg-white/25"}`} />
              <p className={`v-mono mt-0.5 text-center text-[10px] ${s.covered ? "font-bold" : "text-white/80"}`}>{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TermPanel({ term }: { term: BreakdownTerm }) {
  const all = term.modules.map((m) => m.number);
  const [open, setOpen] = useState<Set<number>>(() => new Set(all)); // every module starts expanded
  const toggle = (n: number) => setOpen((s) => { const next = new Set(s); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  const allOpen = open.size === all.length;
  return (
    <div className="space-y-3">
      {term.modules.length > 1 && (
        <div className="flex justify-end">
          <button type="button" className={`rounded-md px-2 text-xs font-medium text-[var(--muted)] underline-offset-2 hover:text-[var(--fg)] hover:underline ${touch}`} onClick={() => setOpen(allOpen ? new Set() : new Set(all))}>{allOpen ? "Collapse all" : "Expand all"}</button>
        </div>
      )}
      {term.modules.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">No modules for {term.label} were found in this syllabus.</p> : (
        <ul className="space-y-3">{term.modules.map((m) => <ModuleCard key={m.number} m={m} open={open.has(m.number)} onToggle={() => toggle(m.number)} />)}</ul>
      )}
    </div>
  );
}

export default function SyllabusOrganizer(p: OrganizerProps) {
  const { breakdown: b, tos } = p;
  const term = b.terms.find((t) => t.period === p.period) ?? b.terms[0];
  const ownNumbers = term.modules.filter((m) => m.kind === "assessed").map((m) => m.number);
  const stated = term.exam && !term.exam.derived ? term.exam.coverage : null;
  const canCumulative = !!stated && (stated.length !== ownNumbers.length || stated.some((n, i) => n !== ownNumbers[i]));
  const sum = tos.rows.reduce((n, r) => n + r.questions, 0);

  return (
    <div data-testid="syllabus-review" className="p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Sidebar b={b} />
          {p.warnings.length > 0 && (
            <ul data-testid="syllabus-warnings" className="space-y-1 rounded-xl border border-[var(--warn-color)]/40 bg-[color-mix(in_srgb,var(--warn-color)_12%,transparent)] p-3 text-xs text-[color-mix(in_srgb,var(--warn-text)_65%,black)] dark:text-[var(--warn-text)]">
              {p.warnings.map((w) => <li key={w}>• {w}</li>)}
            </ul>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] pb-3">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Exam period">
              {b.terms.map((t) => {
                const active = p.period === t.period;
                return (
                  <button key={t.period} type="button" role="tab" id={`period-tab-${t.period}`} aria-selected={active} aria-controls="period-panel" data-testid={`period-tab-${t.period}`} onClick={() => p.onPeriod(t.period)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 text-sm font-semibold ${touch} ${active ? "border-[var(--brand-solid)] bg-[var(--brand-solid)] text-white" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand-soft)]"}`}>
                    <Icon name="calendar" className="size-4" />{t.label}
                  </button>
                );
              })}
            </div>
            <p className={`${gold} ml-auto`} data-testid="period-summary"><Icon name="layers" className="size-3.5" />{term.summary}</p>
          </div>

          <div id="period-panel" role="tabpanel" aria-labelledby={`period-tab-${term.period}`} className="space-y-4">
            <TermPanel key={term.period} term={term} />
            <ExamBanner term={term} />
          </div>

          <section aria-label="Table of Specifications" data-testid="tos-bar" className="v-panel space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h3 className={eyebrow}>Table of Specifications · {term.label}</h3>
              <label className="ml-auto flex items-center gap-2 text-xs text-[var(--muted)]">Total questions
                <input type="number" min={1} max={200} value={tos.totalQuestions} data-testid="tos-total" aria-label="Total questions" className={`v-input w-20 text-sm ${touch}`}
                  onChange={(e) => p.onTotal(Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))))} />
              </label>
            </div>
            {canCumulative && (
              <label className={`flex cursor-pointer items-start gap-2 text-xs ${touch}`}>
                <input type="checkbox" checked={p.cumulative} data-testid="tos-cumulative" onChange={(e) => p.onCumulative(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
                <span>Cover everything the syllabus lists for this exam (<b className="v-mono">{term.exam!.coverageText}</b>), not only {term.label.toLowerCase()} modules.</span>
              </label>
            )}
            {tos.rows.length === 0 ? <p className="text-sm text-[var(--muted)]">No assessed modules for {term.label} were found in this syllabus.</p> : (
              <ul className="space-y-2.5" data-testid="tos-rows">
                {tos.rows.map((r) => (
                  <li key={r.moduleNumber} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                    <div className="truncate"><b className="v-mono">M{r.moduleNumber}</b> {r.title} <span className="v-mono text-[11px] text-[var(--muted)]">{r.courseOutcomes.join(" ")}</span></div>
                    <div className="v-mono text-right text-xs text-[var(--muted)]">{r.questions} Q · {Math.round((r.questions / Math.max(1, tos.totalQuestions)) * 100)}%</div>
                    <input type="range" min={0} max={tos.totalQuestions} value={r.questions} aria-label={`Questions for module ${r.moduleNumber}`} className="col-span-2 w-full accent-[var(--brand)] [color-scheme:light] dark:[color-scheme:dark] [@media(pointer:coarse)]:min-h-11"
                      onChange={(e) => p.onSlide(r.moduleNumber, Number(e.target.value))} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-[var(--muted)]" aria-live="polite">{tos.rows.length ? `${sum} of ${tos.totalQuestions} questions assigned` : ""}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={p.onApply} disabled={!tos.rows.length} data-testid="configure-from-syllabus" className={`v-btn v-btn-primary border-[var(--brand-solid)] bg-[var(--brand-solid)] px-4 text-sm hover:border-[var(--brand-solid-hover)] hover:bg-[var(--brand-solid-hover)] ${touch}`}>Configure exam from syllabus</button>
              <button type="button" onClick={p.onCancel} className={`v-btn px-3 text-sm ${touch}`}>Cancel</button>
            </div>
          </section>
        </div>
      </div>
      <p className="mt-4 truncate text-[11px] text-[var(--muted)]" data-testid="syllabus-source" title={p.fileName}>Source: {p.fileName}</p>
    </div>
  );
}
