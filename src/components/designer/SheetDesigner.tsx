"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { SHEET_PRINTED_EVENT, TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import { normalizeSettings } from "@/lib/omr/columns";
import { sheetSummary } from "@/lib/omr/summary";
import { computeLayout, type LayoutResult } from "@/lib/omr/layout-engine";
import { DEFAULT_SETTINGS } from "@/lib/omr/presets";
import { readStoredTemplate, writeStoredTemplate } from "@/lib/storage/template-store";
import { courseDesignDefaults, parseCourseParams } from "@/lib/courses/courses";
import { writeCourseBinding } from "@/lib/storage/course-library";
import { applyDesignToLocalSections, upsertLocalExam } from "@/lib/storage/exam-library";
import { readStoredPlan } from "@/lib/syllabus/plan-store";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { useCourses } from "@/components/courses/useCourses";
import CourseContextBanner from "./CourseContextBanner";
import type { LayoutSettings } from "@/lib/omr/schema";
import DebugDrawer, { IssueList } from "./DebugDrawer";
import QuickPresets from "./QuickPresets";
import { ExamDetailsFields, SheetSetupFields } from "./SettingsPanel";
import { designerSteps } from "@/lib/omr/designer-steps";
import type { Darkness, PerPage } from "@/lib/omr/print-options";
import { decodeSharedForm, saveSheetForm } from "@/lib/omr/saved-forms";
import ActiveExamBar from "@/components/shell/ActiveExamBar";
import SavedFormsPanel from "./SavedFormsPanel";
import SyllabusDropzone from "./SyllabusDropzone";
import SheetPreview, { type PreviewOverlays } from "./SheetPreview";

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function clearFormParam() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("form")) return;
  params.delete("form");
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}

export default function SheetDesigner() {
  const [settings, setSettingsRaw] = useState<LayoutSettings>(DEFAULT_SETTINGS);
  // user edits (not the random id assigned after hydration) mean "a new exam is being designed"
  const edited = useRef(false);
  // every edit is brought into the supported range (2–6 choices, columns that fit) before it renders
  const setSettings: typeof setSettingsRaw = (v) => { edited.current = true; clearFormParam(); setSettingsRaw(typeof v === "function" ? (cur) => normalizeSettings(v(cur)) : normalizeSettings(v)); };
  const [pageIndex, setPageIndex] = useState(0);
  const [overlays, setOverlays] = useState<PreviewOverlays>({ cells: false, bboxes: false });
  const [drawer, setDrawer] = useState<null | "json" | "issues">(null);
  const [busy, setBusy] = useState(false);
  // print-time only: never changes the template, so any printout scans against the same layout
  const [perPage, setPerPage] = useState<PerPage>(1);
  const [darkness, setDarkness] = useState<Darkness>("standard");
  const [pngBusy, setPngBusy] = useState(false);

  const [sharedBanner, setSharedBanner] = useState<{ kind: "ok" | "warn"; name?: string; saved?: boolean; error?: string } | null>(null);

  // Designing inside a course: `?courseId=` (and optionally `?sectionId=`), read after hydration like `?form=` below.
  const cloud = useCloudSession();
  const [courseCtx, setCourseCtx] = useState<{ courseId: string; sectionId: string | null } | null>(null);
  const { courses, loaded: coursesLoaded, source: courseSource } = useCourses();
  const course = courseCtx ? courses.find((c) => c.id === courseCtx.courseId) ?? null : null;
  const scope = course && courseCtx?.sectionId && course.sections.some((s) => s.id === courseCtx.sectionId) ? courseCtx.sectionId : null;
  const courseMissing = !!courseCtx && coursesLoaded && !course;
  const courseLine = useRef<{ title: string; subtitle: string } | null>(null);
  const filledFor = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Stable random template id + optional shared `?form=` import after hydration (keeps SSR output deterministic).
  useEffect(() => {
    setCourseCtx(parseCourseParams(window.location.search));
    const rawForm = new URLSearchParams(window.location.search).get("form");
    const decoded = rawForm ? decodeSharedForm(rawForm) : null;
    if (decoded) {
      edited.current = true;
      setSettingsRaw((s) => normalizeSettings({
        ...decoded.settings,
        templateId: s.templateId === "tpl-draft" ? `tpl-${crypto.randomUUID().slice(0, 8)}` : s.templateId,
      }));
      setSharedBanner({ kind: "ok", name: decoded.name });
      return;
    }
    if (rawForm) {
      setSharedBanner({ kind: "warn" });
      clearFormParam();
    }
    setSettingsRaw((s) => (s.templateId === "tpl-draft" ? { ...s, templateId: `tpl-${crypto.randomUUID().slice(0, 8)}` } : s));
  }, []);

  // Pre-fill the printed title and course line once the course is known. Never over a shared `?form=` or anything the teacher already typed.
  useEffect(() => {
    if (!course || filledFor.current === course.id) return;
    filledFor.current = course.id;
    if (edited.current) return;
    const d = courseDesignDefaults(course, scope);
    courseLine.current = d;
    edited.current = true;
    setSettingsRaw((s) => normalizeSettings({ ...s, ...d }));
  }, [course, scope]);

  // The sheet being designed belongs to this course: remembered by its template id so printing / saving files it there.
  useEffect(() => {
    if (!course || settings.templateId === "tpl-draft") return;
    writeCourseBinding({ templateId: settings.templateId, courseId: course.id, sectionId: scope });
  }, [course, scope, settings.templateId]);
  // On this device (no workspace) the library entry is made when the sheet is printed.
  useEffect(() => {
    if (!course || courseSource !== "local") return;
    const onPrinted = () => {
      const t = readStoredTemplate();
      if (t && t.templateId === settings.templateId) upsertLocalExam(t, { courseId: course.id, sectionId: scope });
    };
    window.addEventListener(SHEET_PRINTED_EVENT, onPrinted);
    return () => window.removeEventListener(SHEET_PRINTED_EVENT, onPrinted);
  }, [course, scope, courseSource, settings.templateId]);

  function changeScope(next: string | null) {
    if (!course) return;
    setCourseCtx((c) => (c ? { ...c, sectionId: next } : c));
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("sectionId", next); else url.searchParams.delete("sectionId");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    // keep the course line in step with the scope, unless the teacher has edited it since it was filled in
    const prev = courseLine.current;
    if (prev && settings.subtitle === prev.subtitle) {
      const d = courseDesignDefaults(course, next);
      courseLine.current = { ...prev, subtitle: d.subtitle };
      setSettingsRaw((s) => normalizeSettings({ ...s, subtitle: d.subtitle }));
    }
  }

  async function applyCourseSections(sectionIds: string[]) {
    if (!course || !result || !canExport) {
      setBulkError("Fix the sheet layout errors before applying to sections.");
      return;
    }
    setBulkBusy(true);
    setBulkError(null);
    setBulkStatus(null);
    try {
      const baseName = settings.title.trim() || `${course.code} Examination`;
      const storedPlan = readStoredPlan();
      const matchingPlan = storedPlan && storedPlan.templateId === result.template.templateId && storedPlan.tos.totalQuestions === result.template.questionCount ? storedPlan : null;
      if (courseSource === "cloud" && cloud?.workspace.access === "member") {
        await cloud.applyExamsToSections({
          courseId: course.id,
          sectionIds,
          baseName,
          template: result.template,
          plan: matchingPlan,
        });
      } else {
        applyDesignToLocalSections({
          courseId: course.id,
          sectionIds,
          baseName,
          template: result.template,
        });
      }
      setBulkStatus(`Applied "${baseName}" to ${sectionIds.length} ${sectionIds.length === 1 ? "section" : "sections"}.`);
    } catch (e) {
      setBulkError((e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? String(e));
    } finally {
      setBulkBusy(false);
    }
  }

  const deferred = useDeferredValue(settings);
  const outcome = useMemo((): { result: LayoutResult } | { error: string } => {
    try {
      return { result: computeLayout(deferred) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [deferred]);
  const [lastGood, setLastGood] = useState<LayoutResult | null>(null);
  useEffect(() => { if ("result" in outcome) setLastGood(outcome.result); }, [outcome]);
  const result = "result" in outcome ? outcome.result : lastGood;

  const errors = result?.issues.filter((i) => i.severity === "error") ?? [];
  const stale = settings !== deferred;
  const pages = result?.template.pages.length ?? 0;
  const page = Math.min(pageIndex, Math.max(0, pages - 1));
  const canExport = !!result && "result" in outcome && errors.length === 0 && !stale;
  const steps = designerSteps({ title: settings.title, subtitle: settings.subtitle, questions: result?.stats.questions ?? 0, pages, layoutErrors: errors.length });
  const summary = result ? sheetSummary({ questions: result.stats.questions, pages, paper: settings.paper, layoutErrors: errors.length }) : null;

  // Hand the current valid template to the scanner page (same browser).
  useEffect(() => {
    if (!canExport || !result) return;
    writeStoredTemplate(result.template);
    window.dispatchEvent(new Event(TEMPLATE_CHANGED_EVENT));
    if (edited.current) window.dispatchEvent(new Event("veritas:design-edited"));
  }, [canExport, result]);

  const [kitBusy, setKitBusy] = useState(false);
  async function downloadKit() {
    setKitBusy(true);
    try {
      const { buildSampleKitZip } = await import("@/lib/samples/kit-builder");
      download("omr-sample-exam-kit.zip", await buildSampleKitZip(), "application/zip");
    } finally {
      setKitBusy(false);
    }
  }

  async function exportPdf() {
    if (!result) return;
    setBusy(true);
    try {
      const { generatePdf } = await import("@/lib/omr/pdf-generator");
      const bytes = await generatePdf(result.template, { perPage, darkness });
      download(`${result.template.templateId}-v${result.template.version}${perPage > 1 ? `-${perPage}up` : ""}.pdf`, bytes as BlobPart, "application/pdf");
      window.dispatchEvent(new CustomEvent(SHEET_PRINTED_EVENT, { detail: result.template.layoutHash }));
    } finally {
      setBusy(false);
    }
  }

  async function exportPng() {
    if (!result) return;
    setPngBusy(true);
    try {
      const { renderPagePng } = await import("@/lib/omr/png-export");
      const t = result.template;
      const blob = await renderPagePng(t, page, { darkness });
      download(`${t.templateId}-v${t.version}-page${page + 1}.png`, blob, "image/png");
      window.dispatchEvent(new CustomEvent(SHEET_PRINTED_EVENT, { detail: t.layoutHash }));
    } finally {
      setPngBusy(false);
    }
  }

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const SHORT = { 1: "Exam Details", 2: "Answer Sheet", 3: "Review & Download" } as const;
  const prev = step > 1 ? ((step - 1) as 1 | 2) : null;
  const next = step < 3 ? ((step + 1) as 2 | 3) : null;
  const dot = (status: string, current: boolean) => current ? "bg-[var(--brand-solid)] text-white" : status === "done" ? "bg-emerald-600 text-white" : status === "warn" ? "bg-amber-500 text-white" : "border border-[var(--border)] bg-[var(--surface)] text-zinc-500";
  const STATUS_TEXT = { done: "complete", warn: "needs attention", todo: "to do" } as const;

  return (
    <>
      <div className={`mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 ${drawer ? "pb-[48vh]" : ""}`} data-testid="designer">
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Design Exam</h1>
            <p className="mt-2 text-sm text-zinc-500">Set up the exam, choose the answer sheet layout, then download it for printing.</p>
          </div>
          <ActiveExamBar />
        </header>

        {course && (
          <CourseContextBanner
            course={course}
            sectionId={scope}
            onSection={changeScope}
            canBulkApply={canExport}
            bulkBusy={bulkBusy}
            bulkStatus={bulkStatus}
            bulkError={bulkError}
            onBulkApply={applyCourseSections}
          />
        )}
        {courseMissing && (
          <p role="status" data-testid="course-context-missing" className="v-panel px-4 py-3 text-sm">That course is not available, so this exam is being designed outside a course.</p>
        )}

        {sharedBanner && (
          <div
            role="status"
            data-testid="shared-form-banner"
            className={`v-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm ${
              sharedBanner.kind === "warn" ? "border-amber-400/50 bg-amber-500/10" : "border-emerald-400/40 bg-emerald-500/10"
            }`}
          >
            <div className="min-w-0 flex-1">
              {sharedBanner.kind === "warn" ? (
                <p>Shared form link is invalid or incomplete — loaded default sheet instead.</p>
              ) : (
                <p>
                  Loaded shared form <span className="font-semibold">{sharedBanner.name}</span>.
                  {sharedBanner.saved && " Saved to your library."}
                  {sharedBanner.error && <span className="ml-2 text-red-600 dark:text-red-400">{sharedBanner.error}</span>}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sharedBanner.kind === "ok" && !sharedBanner.saved && (
                <button
                  type="button"
                  data-testid="save-shared-form-btn"
                  className="v-btn v-btn-primary min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11"
                  onClick={() => {
                    try {
                      saveSheetForm({ name: sharedBanner.name ?? (settings.title || "Shared Form"), settings });
                      clearFormParam();
                      setSharedBanner((b) => (b ? { ...b, saved: true, error: undefined } : b));
                    } catch (e) {
                      setSharedBanner((b) => (b ? { ...b, error: e instanceof Error ? e.message : String(e) } : b));
                    }
                  }}
                >
                  Save to My Forms
                </button>
              )}
              <button
                type="button"
                data-testid="dismiss-shared-form-btn"
                className="v-btn min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11"
                onClick={() => { clearFormParam(); setSharedBanner(null); }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <nav aria-label="Design steps" data-testid="designer-steps" className="v-panel px-4 py-4 sm:px-6">
          <ol className="flex items-center gap-2 sm:gap-4">
            {steps.map((st, i) => {
              const current = step === st.id;
              return (
                <li key={st.id} className={`flex items-center gap-2 sm:gap-4 ${i < steps.length - 1 ? "flex-1" : ""}`}>
                  <button type="button" aria-current={current ? "step" : undefined} onClick={() => setStep(st.id)} data-testid={`step-tab-${st.id}`} data-status={st.status} className="flex items-center gap-2 rounded-lg p-1 text-left">
                    <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${dot(st.status, current)}`}>{current ? st.id : st.status === "done" ? "✓" : st.status === "warn" ? "!" : st.id}</span>
                    <span className={`text-sm font-semibold ${current ? "" : "hidden text-zinc-500 sm:inline"}`}>{SHORT[st.id]}</span>
                    <span className="sr-only">{STATUS_TEXT[st.status]}</span>
                  </button>
                  {i < steps.length - 1 && <span aria-hidden className="h-px flex-1 bg-[var(--border)]" />}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section aria-labelledby="step-title" className="v-panel flex min-w-0 flex-col" data-testid="step-panel">
            <div className="border-b border-[var(--border)] p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Step {step} of 3</p>
              <h2 id="step-title" className="mt-2 text-lg font-semibold">{steps[step - 1].label}</h2>
            </div>

            <div className="space-y-6 p-6">
              {step === 1 && (
                <div className="space-y-6" data-testid="step-details">
                  <ExamDetailsFields settings={settings} onChange={setSettings} />
                  <SyllabusDropzone settings={settings} onConfigure={(cfg) => { setSettings(cfg); setPageIndex(0); }} />
                </div>
              )}
              {step === 2 && (
                <div className="space-y-6" data-testid="step-setup">
                  <QuickPresets settings={settings} onApply={(s) => { setSettings(s); setPageIndex(0); }} />
                  <SavedFormsPanel settings={settings} onApply={(s) => { setSettings(s); setPageIndex(0); }} />
                  <SheetSetupFields settings={settings} onChange={setSettings} />
                </div>
              )}
              {step === 3 && (
                <div className="space-y-6" data-testid="step-review">
                  <ul className="space-y-2 text-sm" data-testid="review-checklist">
                    {steps.slice(0, 2).map((st) => (
                      <li key={st.id} className="flex items-center gap-2">
                        <span aria-hidden className={st.status === "done" ? "text-emerald-600" : st.status === "warn" ? "text-amber-600" : "text-zinc-400"}>{st.status === "done" ? "✓" : st.status === "warn" ? "!" : "○"}</span>
                        {st.label}
                      </li>
                    ))}
                    <li className="flex items-center gap-2">
                      <span aria-hidden className={steps[2].status === "done" ? "text-emerald-600" : "text-amber-600"}>{steps[2].status === "done" ? "✓" : "!"}</span>
                      {summary ? summary.text.replace(/^✓\s*/, "") : "Checking the layout…"}
                    </li>
                  </ul>
                  {errors.length > 0 && <div className="v-panel overflow-hidden"><IssueList issues={errors.slice(0, 5)} /></div>}
                  <fieldset className="v-panel space-y-3 p-4" data-testid="print-options">
                    <legend className="px-1 text-sm font-semibold">Print options</legend>
                    <div>
                      <p id="perpage-label" className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Sheets per page</p>
                      <div className="v-tabs" role="radiogroup" aria-labelledby="perpage-label">
                        {([1, 2, 4] as const).map((n) => (
                          <button key={n} type="button" role="radio" aria-checked={perPage === n} data-testid={`perpage-${n}`} onClick={() => setPerPage(n)} className="v-tab">{n === 1 ? "1 per page" : `${n} per page`}</button>
                        ))}
                      </div>
                      {perPage > 1 && <p className="mt-1 text-xs text-zinc-500">Copies of the same sheet, scaled down evenly. Cut along the dashed guides before handing out. Smaller sheets need a clean print: test one before a full class set.</p>}
                    </div>
                    <div>
                      <p id="darkness-label" className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Ink</p>
                      <div className="v-tabs" role="radiogroup" aria-labelledby="darkness-label">
                        <button type="button" role="radio" aria-checked={darkness === "standard"} data-testid="darkness-standard" onClick={() => setDarkness("standard")} className="v-tab">Standard</button>
                        <button type="button" role="radio" aria-checked={darkness === "high"} data-testid="darkness-high" onClick={() => setDarkness("high")} className="v-tab">High contrast (photocopy)</button>
                      </div>
                    </div>
                  </fieldset>
                  <div className="space-y-2">
                    <button type="button" disabled={!canExport || busy} data-testid="download-pdf" className="v-btn v-btn-primary min-h-10 w-full" onClick={exportPdf}>
                      {busy ? "Preparing PDF…" : "Download Answer Sheet (PDF)"}
                    </button>
                    <button type="button" disabled={!canExport || pngBusy} data-testid="download-png" className="v-btn min-h-10 w-full"
                      title="One page as a picture, to place in a Word document or exam booklet" onClick={exportPng}>
                      {pngBusy ? "Preparing image…" : `Download Page ${page + 1} as Image (PNG)`}
                    </button>
                    <button type="button" disabled={kitBusy} className="v-btn min-h-10 w-full border-transparent bg-transparent text-zinc-600 dark:text-zinc-400"
                      title="A ready-made 20-question exam with answer key, class list and practice scans" onClick={downloadKit}>
                      {kitBusy ? "Preparing…" : "Load Sample Exam"}
                    </button>
                  </div>
                  <details className="v-panel p-4" data-testid="developer-tools">
                    <summary className="cursor-pointer text-sm font-medium">Advanced / Developer Tools</summary>
                    <div className="mt-4 space-y-2 text-sm">
                      <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400"><input type="checkbox" name="show-reference-cells" className="accent-indigo-600" checked={overlays.cells} onChange={(e) => setOverlays((o) => ({ ...o, cells: e.target.checked }))} /> Show reference cells</label>
                      <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400"><input type="checkbox" name="show-bounding-boxes" className="accent-indigo-600" checked={overlays.bboxes} onChange={(e) => setOverlays((o) => ({ ...o, bboxes: e.target.checked }))} /> Show bounding boxes</label>
                      <div className="flex flex-wrap gap-2 pt-2">
                        <button type="button" className="v-btn" onClick={() => setDrawer(drawer ? null : "json")}>{"{ }"} Inspect JSON</button>
                        <button type="button" disabled={!canExport} className="v-btn"
                          onClick={() => { if (!result) return; download(`template-coordinates.json`, JSON.stringify(result.template, null, 2), "application/json"); window.dispatchEvent(new CustomEvent(SHEET_PRINTED_EVENT, { detail: result.template.layoutHash })); }}>Download JSON</button>
                      </div>
                      {result && <p className="v-mono text-[11px] text-zinc-500">{result.stats.bubbles} bubbles · {result.stats.marksPerPage} marks/page · #{result.template.layoutHash}</p>}
                    </div>
                  </details>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-[var(--border)] p-6">
              {prev && <button type="button" className="v-btn min-h-10 px-4" onClick={() => setStep(prev)} data-testid="step-back">Back</button>}
              {next && <button type="button" className="v-btn v-btn-primary ml-auto min-h-10 px-4" onClick={() => setStep(next)} data-testid="step-next">Continue to {SHORT[next]}</button>}
            </div>
          </section>

          <aside aria-label="Answer sheet preview" data-testid="design-canvas" className="v-panel min-w-0 lg:sticky lg:top-[calc(var(--app-header-h,56px)+24px)] lg:max-h-[calc(100dvh-var(--app-header-h,56px)-48px)] lg:overflow-y-auto">
            <div className="space-y-4 border-b border-[var(--border)] p-6">
              <div className="flex flex-wrap items-center gap-4">
                <h2 className="text-lg font-semibold">Answer Sheet Preview</h2>
                {pages > 1 && (
                  <div className="v-tabs ml-auto" role="tablist" aria-label="Pages">
                    {Array.from({ length: pages }, (_, i) => (
                      <button key={i} role="tab" aria-selected={i === page} type="button" onClick={() => setPageIndex(i)} className="v-tab">Page {i + 1}</button>
                    ))}
                  </div>
                )}
              </div>
              {result && summary && (
                <p data-testid="sheet-summary" data-tone={summary.tone} role="status"
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${summary.tone === "ok" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : summary.tone === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"}`}>
                  {summary.text}
                  {summary.tone === "error" && <button type="button" className="ml-2 underline" onClick={() => setDrawer("issues")}>Details</button>}
                </p>
              )}
            </div>
            <div className="bg-[var(--bg)] p-6">
              {"error" in outcome && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  Invalid settings: {outcome.error}
                </div>
              )}
              {errors.length > 0 && step !== 3 && (
                <div className="v-panel mb-4 overflow-hidden"><IssueList issues={errors.slice(0, 5)} /></div>
              )}
              {result && (
                <div className={`mx-auto max-w-[820px] transition-opacity ${stale ? "opacity-70" : ""}`}>
                  <SheetPreview template={result.template} pageIndex={page} overlays={overlays} />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {result && <DebugDrawer key={drawer ?? "closed"} open={!!drawer} initialTab={drawer ?? "json"} onClose={() => setDrawer(null)} result={result} />}
    </>
  );
}
