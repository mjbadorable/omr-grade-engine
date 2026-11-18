"use client";
/**
 * Zero-friction syllabus drop: the teacher drags the official syllabus PDF onto this strip and the
 * exam configures itself (title, subtitle, length) with an auto-generated Table of Specifications.
 * The review dialog is the Syllabus Breakdown & TOS Organizer: the decisions left are the exam period,
 * the question total and, optionally, the per-module sliders.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutSettings } from "@/lib/omr/schema";
import { buildBreakdown } from "@/lib/syllabus/breakdown";
import { parseSyllabusPdf } from "@/lib/syllabus/parse-syllabus";
import { makePlan, readStoredPlan, writeStoredPlan } from "@/lib/syllabus/plan-store";
import { configureSheet, totalQuestions } from "@/lib/syllabus/sheet-config";
import { generateTos, resizeTos, setModuleQuestions, type Tos } from "@/lib/syllabus/tos";
import { PERIOD_LABEL, type ExamPeriod, type ParseResult } from "@/lib/syllabus/types";
import SyllabusOrganizer from "./SyllabusOrganizer";

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
  const [cumulative, setCumulative] = useState(false);
  const [tos, setTos] = useState<Tos | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  // read after mount so server and client render the same first paint
  useEffect(() => {
    const p = readStoredPlan();
    setApplied(p && p.templateId === settings.templateId ? `${p.syllabus.courseCode} · ${PERIOD_LABEL[p.period]}` : null);
  }, [settings.templateId]);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeReview = () => { setParsed(null); setTos(null); setError(null); setCumulative(false); };
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (parsed && !d.open) {
      d.showModal();
      // open at the top with the active period tab focused (the browser would otherwise focus the first control it finds, which can scroll the dialog)
      d.scrollTop = 0;
      d.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    }
    if (!parsed && d.open) d.close();
  }, [parsed]);
  const total = totalQuestions(settings);

  const ingest = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setError("Please drop a PDF file (the official course syllabus)."); return; }
    if (file.size > MAX_BYTES) { setError("That PDF is larger than 15 MB."); return; }
    setBusy(true);
    try {
      const result = await parseSyllabusPdf(await file.arrayBuffer(), undefined, { fileName: file.name });
      if (!result.syllabus.modules.length && !result.syllabus.courseOutcomes.length) {
        setError("No course outcomes or modules were found. Is this a scanned image? Text-based PDFs work best.");
        return;
      }
      // open on the first term that has assessed modules (an orientation-only PRELIM would otherwise open empty)
      const first = buildBreakdown(result.syllabus).terms.find((t) => t.assessedCount > 0)?.period ?? "PRELIM";
      setPeriod(first); setCumulative(false);
      setParsed({ result, fileName: file.name });
      setTos(generateTos(result.syllabus, first, total));
    } catch (e) {
      setError(`Could not read that PDF: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }, [total]);

  const syllabus = parsed?.result.syllabus;
  const breakdown = useMemo(() => (syllabus ? buildBreakdown(syllabus) : null), [syllabus]);
  const changePeriod = (p: ExamPeriod) => { setPeriod(p); if (syllabus && tos) setTos(generateTos(syllabus, p, tos.totalQuestions, { cumulative })); };
  const changeCumulative = (v: boolean) => { setCumulative(v); if (syllabus && tos) setTos(generateTos(syllabus, period, tos.totalQuestions, { cumulative: v })); };

  function apply() {
    if (!syllabus || !tos) return;
    if (!tos.rows.length) { setError("This syllabus has no modules for the selected exam period."); return; }
    const cfg = configureSheet(settings, syllabus, period, tos.totalQuestions);
    if (!cfg.ok) { setError(cfg.error); return; }
    writeStoredPlan(makePlan(syllabus, period, tos, { templateId: cfg.settings.templateId }));
    onConfigure(cfg.settings);
    setApplied(`${syllabus.courseCode} · ${PERIOD_LABEL[period]}`);
    closeReview();
  }

  return (
    <section aria-label="Course syllabus" data-testid="syllabus-card" className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Auto-fill</h2>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void ingest(e.dataTransfer.files[0]); }}
        className={`rounded-xl border-2 border-dashed p-3 text-sm transition ${over ? "border-[var(--gold)] bg-[var(--gold-tint)]" : "border-[var(--border)]"}`}
      >
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-[var(--brand)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-tight">{busy ? "Reading syllabus…" : "Auto-Fill from Syllabus (PDF)"}</p>
            <p className="text-[11px] leading-snug text-[var(--muted)]">{applied ? <>Using <b>{applied}</b></> : "Drop your course syllabus: outcomes and exam details fill in for you."}</p>
          </div>
        </div>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Course syllabus PDF" onChange={(e) => { void ingest(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="v-btn min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11">Choose PDF…</button>
          {applied && <button type="button" className="text-[11px] text-[var(--muted)] underline" onClick={() => { writeStoredPlan(null); setApplied(null); }}>unlink</button>}
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-[var(--brand-text-on-tint)]">{error}</p>}

      <dialog ref={dialog} aria-label="Review syllabus" data-testid="syllabus-dialog"
        onCancel={(e) => { e.preventDefault(); closeReview(); }} onClick={(e) => { if (e.target === dialog.current) closeReview(); }}
        className="m-auto max-h-[calc(100dvh-1rem)] w-[min(86rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-0 text-[var(--fg)] shadow-2xl backdrop:bg-black/50">
        <div className="h-1.5 bg-gradient-to-r from-[var(--brand)] via-[var(--gold)] to-[var(--brand)]" />
        {parsed && syllabus && tos && breakdown && (
          <SyllabusOrganizer
            fileName={parsed.fileName} warnings={parsed.result.warnings} breakdown={breakdown}
            period={period} onPeriod={changePeriod}
            tos={tos} onTotal={(n) => setTos(resizeTos(tos, n))} onSlide={(m, q) => setTos(setModuleQuestions(tos, m, q))}
            cumulative={cumulative} onCumulative={changeCumulative}
            onApply={apply} onCancel={closeReview}
          />
        )}
        {error && parsed && <p role="alert" className="px-6 pb-4 text-xs text-[var(--brand-text-on-tint)]">{error}</p>}
      </dialog>
    </section>
  );
}
