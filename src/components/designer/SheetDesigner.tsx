"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { SHEET_PRINTED_EVENT, TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import { normalizeSettings } from "@/lib/omr/columns";
import { sheetSummary } from "@/lib/omr/summary";
import { computeLayout, type LayoutResult } from "@/lib/omr/layout-engine";
import { DEFAULT_SETTINGS } from "@/lib/omr/presets";
import { writeStoredTemplate } from "@/lib/storage/template-store";
import type { LayoutSettings } from "@/lib/omr/schema";
import DebugDrawer, { IssueList } from "./DebugDrawer";
import QuickPresets from "./QuickPresets";
import { ExamDetailsFields, SheetSetupFields } from "./SettingsPanel";
import { designerSteps } from "@/lib/omr/designer-steps";
import ActiveExamBar from "@/components/shell/ActiveExamBar";
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


export default function SheetDesigner() {
  const [settings, setSettingsRaw] = useState<LayoutSettings>(DEFAULT_SETTINGS);
  // user edits (not the random id assigned after hydration) mean "a new exam is being designed"
  const edited = useRef(false);
  // every edit is brought into the supported range (2–6 choices, columns that fit) before it renders
  const setSettings: typeof setSettingsRaw = (v) => { edited.current = true; setSettingsRaw(typeof v === "function" ? (cur) => normalizeSettings(v(cur)) : normalizeSettings(v)); };
  const [pageIndex, setPageIndex] = useState(0);
  const [overlays, setOverlays] = useState<PreviewOverlays>({ cells: false, bboxes: false });
  const [drawer, setDrawer] = useState<null | "json" | "issues">(null);
  const [busy, setBusy] = useState(false);

  // Stable random template id, assigned after hydration (keeps SSR output deterministic).
  useEffect(() => {
    setSettingsRaw((s) => (s.templateId === "tpl-draft" ? { ...s, templateId: `tpl-${crypto.randomUUID().slice(0, 8)}` } : s));
  }, []);

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
      const bytes = await generatePdf(result.template);
      download(`${result.template.templateId}-v${result.template.version}.pdf`, bytes as BlobPart, "application/pdf");
      window.dispatchEvent(new CustomEvent(SHEET_PRINTED_EVENT, { detail: result.template.layoutHash }));
    } finally {
      setBusy(false);
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
                  <div className="space-y-2">
                    <button type="button" disabled={!canExport || busy} data-testid="download-pdf" className="v-btn v-btn-primary min-h-10 w-full" onClick={exportPdf}>
                      {busy ? "Preparing PDF…" : "Download Answer Sheet (PDF)"}
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
