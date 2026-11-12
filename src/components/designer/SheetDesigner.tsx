"use client";

import AppNav from "@/components/AppNav";
import Brand from "@/components/brand/Brand";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { computeLayout, type LayoutResult } from "@/lib/omr/layout-engine";
import { DEFAULT_SETTINGS, PRESETS } from "@/lib/omr/presets";
import { writeStoredTemplate } from "@/lib/storage/template-store";
import type { LayoutSettings } from "@/lib/omr/schema";
import DebugDrawer, { IssueList } from "./DebugDrawer";
import QuickPresets from "./QuickPresets";
import SettingsPanel from "./SettingsPanel";
import HeroStrip from "./HeroStrip";
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

const btn = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

export default function SheetDesigner() {
  const [settings, setSettings] = useState<LayoutSettings>(DEFAULT_SETTINGS);
  const [pageIndex, setPageIndex] = useState(0);
  const [overlays, setOverlays] = useState<PreviewOverlays>({ cells: false, bboxes: false });
  const [drawer, setDrawer] = useState<null | "json" | "issues">(null);
  const [busy, setBusy] = useState(false);

  // Stable random template id, assigned after hydration (keeps SSR output deterministic).
  useEffect(() => {
    setSettings((s) => (s.templateId === "tpl-draft" ? { ...s, templateId: `tpl-${crypto.randomUUID().slice(0, 8)}` } : s));
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

  // Hand the current valid template to the scanner page (same browser).
  useEffect(() => {
    if (!canExport || !result) return;
    writeStoredTemplate(result.template);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
        <Brand page="Sheet Designer" />
        <AppNav />
        <select aria-label="Load preset" className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          value="" onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value);
            if (p) { setSettings((s) => ({ ...p.settings, templateId: s.templateId })); setPageIndex(0); }
          }}>
          <option value="" disabled>Load preset…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {result && (
          <div className="hidden items-center gap-3 font-mono text-xs text-zinc-500 md:flex">
            <span>{result.stats.questions} Q</span>
            <span>{result.stats.bubbles} bubbles</span>
            <span>{pages} page{pages === 1 ? "" : "s"}</span>
            <span>{result.stats.marksPerPage} marks/page</span>
            <span title="Layout hash (first 64 bits of SHA-256)">#{result.template.layoutHash}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={kitBusy} className={`${btn} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`}
            title="20-question PDF, answer key, roster CSV and 5 simulated scans in one zip" onClick={downloadKit}>
            {kitBusy ? "Building kit…" : "Sample exam kit"}
          </button>
          <button type="button" className={`${btn} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`} onClick={() => setDrawer(drawer ? null : "json")}>
            {"{ }"} Inspect JSON
          </button>
          <button type="button" disabled={!canExport} className={`${btn} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`}
            onClick={() => result && download(`template-coordinates.json`, JSON.stringify(result.template, null, 2), "application/json")}>
            Download JSON
          </button>
          <button type="button" disabled={!canExport || busy} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`} onClick={exportPdf}>
            {busy ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </header>

      <HeroStrip />
      <SyllabusDropzone settings={settings} onConfigure={(next) => { setSettings(next); setPageIndex(0); }} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="shrink-0 overflow-y-auto border-b border-zinc-200 bg-white p-4 lg:w-[360px] lg:border-r lg:border-b-0 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="space-y-6">
            <QuickPresets settings={settings} onApply={(s) => { setSettings(s); setPageIndex(0); }} />
            <SettingsPanel settings={settings} onChange={setSettings} />
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
            <div className="flex gap-1" role="tablist" aria-label="Pages">
              {Array.from({ length: pages }, (_, i) => (
                <button key={i} role="tab" aria-selected={i === page} type="button" onClick={() => setPageIndex(i)}
                  className={`rounded-md px-2.5 py-1 ${i === page ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
                  Page {i + 1}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" className="accent-indigo-600" checked={overlays.cells} onChange={(e) => setOverlays((o) => ({ ...o, cells: e.target.checked }))} /> Reference cells
            </label>
            <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" className="accent-indigo-600" checked={overlays.bboxes} onChange={(e) => setOverlays((o) => ({ ...o, bboxes: e.target.checked }))} /> Bounding boxes
            </label>
            <button type="button" onClick={() => setDrawer("issues")}
              className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${errors.length ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"}`}>
              {errors.length ? `${errors.length} layout error${errors.length > 1 ? "s" : ""}` : "Layout valid"}
            </button>
          </div>

          <div className={`min-h-0 flex-1 overflow-auto p-4 sm:p-8 ${drawer ? "pb-[48vh]" : ""}`}>
            {"error" in outcome && (
              <div className="mx-auto mb-4 max-w-[820px] rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                Invalid settings: {outcome.error}
              </div>
            )}
            {errors.length > 0 && (
              <div className="mx-auto mb-4 max-w-[820px] overflow-hidden rounded-md border border-red-200 bg-white dark:border-red-500/30 dark:bg-zinc-950">
                <IssueList issues={errors.slice(0, 5)} />
              </div>
            )}
            {result && (
              <div className={`mx-auto max-w-[820px] transition-opacity ${stale ? "opacity-70" : ""}`}>
                <SheetPreview template={result.template} pageIndex={page} overlays={overlays} />
              </div>
            )}
          </div>
        </main>
      </div>

      {result && <DebugDrawer key={drawer ?? "closed"} open={!!drawer} initialTab={drawer ?? "json"} onClose={() => setDrawer(null)} result={result} />}
    </div>
  );
}
