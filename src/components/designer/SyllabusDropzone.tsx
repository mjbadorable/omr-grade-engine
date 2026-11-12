"use client";
/**
 * Zero-friction syllabus drop: the teacher drags the official syllabus PDF onto this strip and the
 * exam configures itself (title, subtitle, length) with an auto-generated Table of Specifications.
 * The only decisions left are the exam period and, optionally, the TOS sliders.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutSettings } from "@/lib/omr/schema";
import { parseSyllabusPdf } from "@/lib/syllabus/parse-syllabus";
import { makePlan, readStoredPlan, writeStoredPlan } from "@/lib/syllabus/plan-store";
import { configureSheet, totalQuestions } from "@/lib/syllabus/sheet-config";
import { generateTos, resizeTos, setModuleQuestions, type Tos } from "@/lib/syllabus/tos";
import { EXAM_PERIODS, PERIOD_LABEL, type ExamPeriod, type ParseResult } from "@/lib/syllabus/types";

interface Props {
  settings: LayoutSettings;
  onConfigure: (next: LayoutSettings) => void;
}

const MAX_BYTES = 15 * 1024 * 1024;

export default function SyllabusDropzone({ settings, onConfigure }: Props) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ result: ParseResult; fileName: string } | null>(null);
  const [period, setPeriod] = useState<ExamPeriod>("PRELIM");
  const [tos, setTos] = useState<Tos | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  // read after mount so server and client render the same first paint
  useEffect(() => {
    const p = readStoredPlan();
    setApplied(p && p.templateId === settings.templateId ? `${p.syllabus.courseCode} · ${PERIOD_LABEL[p.period]}` : null);
  }, [settings.templateId]);
  const input = useRef<HTMLInputElement>(null);
  const total = totalQuestions(settings);

  const ingest = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setError("Please drop a PDF file (the official course syllabus)."); return; }
    if (file.size > MAX_BYTES) { setError("That PDF is larger than 15 MB."); return; }
    setBusy(true);
    try {
      const result = await parseSyllabusPdf(await file.arrayBuffer());
      if (!result.syllabus.modules.length && !result.syllabus.courseOutcomes.length) {
        setError("No course outcomes or modules were found. Is this a scanned image? Text-based PDFs work best.");
        return;
      }
      setParsed({ result, fileName: file.name });
      setTos(generateTos(result.syllabus, period, total));
    } catch (e) {
      setError(`Could not read that PDF: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }, [period, total]);

  const syllabus = parsed?.result.syllabus;
  const changePeriod = (p: ExamPeriod) => { setPeriod(p); if (syllabus && tos) setTos(generateTos(syllabus, p, tos.totalQuestions)); };

  function apply() {
    if (!syllabus || !tos) return;
    if (!tos.rows.length) { setError("This syllabus has no modules for the selected exam period."); return; }
    const cfg = configureSheet(settings, syllabus, period, tos.totalQuestions);
    if (!cfg.ok) { setError(cfg.error); return; }
    writeStoredPlan(makePlan(syllabus, period, tos, { templateId: cfg.settings.templateId }));
    onConfigure(cfg.settings);
    setApplied(`${syllabus.courseCode} · ${PERIOD_LABEL[period]}`);
    setParsed(null); setTos(null); setError(null);
  }

  return (
    <section aria-label="Course syllabus" className="border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void ingest(e.dataTransfer.files[0]); }}
        className={`flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed px-4 py-2.5 text-sm transition ${over ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-300 dark:border-zinc-700"}`}
      >
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{busy ? "Reading syllabus…" : "Drop Course Syllabus PDF to Auto-Configure Exam"}</div>
          <div className="text-xs text-zinc-500">
            {applied ? <>Sheet configured from <b>{applied}</b>. Outcomes will be bound automatically when you grade.</> : "Course outcomes, program outcomes and modules are extracted for you. No typing."}
          </div>
        </div>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Course syllabus PDF" onChange={(e) => { void ingest(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900">Browse PDF…</button>
        {applied && <button type="button" className="text-xs text-zinc-500 underline" onClick={() => { writeStoredPlan(null); setApplied(null); }}>unlink</button>}
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {parsed && syllabus && tos && (
        <div className="mt-3 grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] dark:border-zinc-800 dark:bg-zinc-950" data-testid="syllabus-review">
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-zinc-500">{parsed.fileName}</div>
              <h2 className="text-base font-semibold">{syllabus.courseCode} · {syllabus.courseTitle}</h2>
              {syllabus.term && <div className="text-xs text-zinc-500">{syllabus.term}</div>}
            </div>
            <ul className="flex flex-wrap gap-1.5 text-xs">
              {[`${syllabus.programOutcomes.length} program outcomes`, `${syllabus.courseOutcomes.length} course outcomes`, `${syllabus.modules.length} modules`, `${syllabus.gradingPolicy.lectureWeight}% lecture / ${syllabus.gradingPolicy.labWeight}% lab`].map((t) => (
                <li key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">{t}</li>
              ))}
            </ul>
            {parsed.result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                {parsed.result.warnings.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            )}
            <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {syllabus.courseOutcomes.map((c) => <li key={c.code}><b className="text-zinc-900 dark:text-zinc-100">{c.code}</b> {c.description} {c.programOutcomes.length > 0 && <span className="text-zinc-400">(PO {c.programOutcomes.join(", ")})</span>}</li>)}
            </ul>
          </div>

          <div className="space-y-3">
            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Exam period</legend>
              <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="radiogroup">
                {EXAM_PERIODS.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => changePeriod(p)}
                    className={`rounded px-3 py-1 text-sm ${period === p ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>{PERIOD_LABEL[p]}</button>
                ))}
              </div>
            </fieldset>

            <div>
              <div className="mb-1 flex items-center gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Table of Specifications</h3>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">Total questions
                  <input type="number" min={1} max={200} value={tos.totalQuestions} className="w-16 rounded border border-zinc-300 px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    onChange={(e) => setTos(resizeTos(tos, Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1)))))} />
                </label>
              </div>
              {tos.rows.length === 0 ? <p className="text-sm text-zinc-500">No modules for {PERIOD_LABEL[period]} were found in this syllabus.</p> : (
                <ul className="space-y-2">
                  {tos.rows.map((r) => (
                    <li key={r.moduleNumber} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
                      <div className="truncate"><b>Module {r.moduleNumber}</b> {r.title} <span className="text-xs text-zinc-400">{r.courseOutcomes.join(", ")}</span></div>
                      <div className="text-right tabular-nums text-xs text-zinc-500">{r.questions} Q · {Math.round((r.questions / Math.max(1, tos.totalQuestions)) * 100)}%</div>
                      <input type="range" min={0} max={tos.totalQuestions} value={r.questions} aria-label={`Questions for module ${r.moduleNumber}`} className="col-span-2 w-full accent-indigo-600"
                        onChange={(e) => setTos(setModuleQuestions(tos, r.moduleNumber, Number(e.target.value)))} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={apply} disabled={!tos.rows.length} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40">Configure exam from syllabus</button>
              <button type="button" onClick={() => { setParsed(null); setTos(null); setError(null); }} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
