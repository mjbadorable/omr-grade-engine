"use client";

import { EmptyHero } from "@/components/brand/Brand";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { bodyToAnswerKey } from "@/lib/cloud/convert";
import type { AnswerKey } from "@/lib/grading/types";
import { playChime, readAutoSnap, readMuted, unlockAudio, writeAutoSnap, writeMuted } from "@/lib/audio/chime";
import { type InstantResult, instantResult } from "@/lib/scan-result";
import { AutoSnapGate } from "@/lib/vision/auto-snap";
import { OMRTemplateSchema, type OMRTemplate } from "@/lib/omr/schema";
import { readStoredKey, readStoredTemplate, writeStoredTemplate } from "@/lib/storage/template-store";

import type { ScanOutput } from "@/lib/vision/scan-sheet";
import { ScannerClient } from "@/lib/vision/scanner-client";
import type { CornerPoints, ScanTelemetry, VisionErrorPayload } from "@/lib/vision/types";
import { bitmapToJpeg, putScan } from "@/lib/storage/scan-store";
import { advise, buildDiagnosticExport, RING_STYLE, summarize } from "@/lib/vision/diagnostics";
import { analyzeFrame, type FrameQuality, guidance, StabilityTracker, type StabilityState } from "@/lib/vision/frame-quality";
import { DEFAULT_TUNING, isDefaultTuning, normalizeTuning, readStoredTuning, type ScanTuning, TUNING_LIMITS, TUNING_PRESETS, writeStoredTuning } from "@/lib/vision/tuning";
import { identity, recordScan } from "@/lib/sync/local-sync";
import ReviewCanvas from "./ReviewCanvas";

interface Job {
  id: number;
  name: string;
  status: "queued" | "scanning" | "done" | "error";
  stage?: string;
  result?: ScanOutput;
  preview?: ImageBitmap | null;
  error?: VisionErrorPayload;
  /** ZipGrade-style instant score (null key → no score) */
  instant?: InstantResult;
  /** original file, kept so a calibration rescan can reuse it with other settings */
  source?: Blob;
  /** calibration run: not saved to the gradebook and not uploaded */
  calibration?: boolean;
  tuning?: ScanTuning;
  /** upload state when a cloud exam is selected */
  cloud?: "uploading" | "stored" | "already_stored" | "duplicate_identical" | "conflict" | "rejected" | "failed";
}

const btn = "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

export default function ScannerApp() {
  const client = useRef<ScannerClient | null>(null);
  const [engine, setEngine] = useState<{ state: "loading" | "ready" | "error"; ms?: number; message?: string }>({ state: "loading" });
  const [template, setTemplate] = useState<OMRTemplate | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const jobSeq = useRef(0);
  // ---- instant result banner, sound, auto-snap
  const [muted, setMuted] = useState(false);
  const [banner, setBanner] = useState<number | null>(null);
  const cloudKey = useRef<AnswerKey | null>(null);
  const rearm = useRef<() => void>(() => {});
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setModeState] = useState<"upload" | "camera">("upload");
  useEffect(() => { setMuted(readMuted()); }, []);
  const toggleMute = () => { const m = !muted; setMuted(m); writeMuted(m); if (!m) { unlockAudio(); playChime(); } };
  // ---- field calibration
  const [tuning, setTuning] = useState<ScanTuning>(DEFAULT_TUNING);
  const [diagnostics, setDiagnostics] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;
  const calibrationRef = useRef(calibrationMode);
  calibrationRef.current = calibrationMode;
  useEffect(() => { setTuning(readStoredTuning()); try { setDiagnostics(localStorage.getItem("omr:diagnostics") === "1"); } catch { /* ignore */ } }, []);
  const updateTuning = (t: Partial<ScanTuning>) => { const n = normalizeTuning({ ...tuningRef.current, ...t }); setTuning(n); writeStoredTuning(n); };
  const toggleDiagnostics = (on: boolean) => { setDiagnostics(on); try { localStorage.setItem("omr:diagnostics", on ? "1" : "0"); } catch { /* ignore */ } };
  const session = useCloudSession();
  const cloudTemplate = session?.examTemplate ?? null;
  // a selected cloud exam dictates the sheet layout being scanned
  useEffect(() => { if (cloudTemplate) setTemplate(cloudTemplate); }, [cloudTemplate]);

  // ---- worker lifecycle
  useEffect(() => {
    const c = new ScannerClient();
    client.current = c;
    c.init().then(({ loadMs }) => setEngine({ state: "ready", ms: loadMs }))
      .catch((e: VisionErrorPayload) => setEngine({ state: "error", message: e.message }));
    setTemplate(readStoredTemplate());
    return () => c.terminate();
  }, []);

  useEffect(() => {
    if (template && client.current) client.current.setTemplate(template).catch(() => {});
  }, [template]);

  const patchJob = useCallback((id: number, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j))), []);

  const runScan = useCallback(async (name: string, source: Blob | ImageBitmap, opts: { calibration?: boolean } = {}) => {
    const id = ++jobSeq.current;
    const calibration = opts.calibration ?? calibrationRef.current;
    const used = tuningRef.current;
    setJobs((js) => [{ id, name, status: "queued", calibration, tuning: used, ...(source instanceof Blob ? { source } : {}) }, ...js]);
    setSelected(id);
    try {
      patchJob(id, { status: "scanning" });
      const { result, preview } = await client.current!.scan(source, { options: { tuning: used }, onTelemetry: (t) => patchJob(id, { stage: t.stage }) });
      const key = readStoredKey(result.layoutHash) ?? (session?.selection.layoutHash === result.layoutHash ? cloudKey.current : null);
      const instant = instantResult(result.fields, key);
      patchJob(id, { status: "done", result, preview, instant });
      setBanner(id);
      playChime("success");
      if (calibration) return;     // benchmarking only: nothing reaches the gradebook or the cloud
      // hand the result to the gradebook (IndexedDB) and queue it for sync (outbox)
      const { deviceId, teacherId } = identity();
      const stored = {
        sheetId: crypto.randomUUID(), layoutHash: result.layoutHash, templateId: result.templateId, name, createdAt: Date.now(),
        result, preview: preview ? await bitmapToJpeg(preview) : null, deviceId, teacherId,
      };
      await putScan(stored).then(() => recordScan(stored)).catch(() => { /* storage unavailable: results stay on screen */ });
      if (session?.selection.examId && session.selection.layoutHash === result.layoutHash) {
        patchJob(id, { cloud: "uploading" });
        session.uploadScan(stored)
          .then((r) => patchJob(id, { cloud: r ? (r.status as Job["cloud"]) : "failed" }))
          .catch(() => patchJob(id, { cloud: "failed" }));
      }
    } catch (e) {
      patchJob(id, { status: "error", error: e as VisionErrorPayload });
      playChime("warn");
    }
  }, [patchJob, session]);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await runScan(f.name, f); // worker is sequential anyway
  }

  async function onTemplateFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = OMRTemplateSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid template");
      setTemplate(parsed.data);
      setTemplateError(null);
      writeStoredTemplate(parsed.data);
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : String(e));
    }
  }

  const current = jobs.find((j) => j.id === selected) ?? null;
  const ready = engine.state === "ready" && !!template;

  return (
    <div className="flex min-h-dvh flex-col">
      <div role="toolbar" aria-label="Scanner actions" data-testid="page-toolbar" className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="ml-auto flex items-center gap-2 order-last">
          <button type="button" onClick={toggleMute} aria-pressed={muted} data-testid="mute-toggle" title={muted ? "Sounds off: click to unmute" : "Success chime on: click to mute"}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M11 5 6 9H3v6h3l5 4z" />{muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" />}</svg>
            {muted ? "Muted" : "Sound"}
          </button>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${engine.state === "ready" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : engine.state === "error" ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
          {engine.state === "ready" ? "Scanner Ready" : engine.state === "error" ? `Scanner unavailable: ${engine.message}` : "Starting scanner…"}
        </span>
      </div>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[380px_1fr]">
        <section className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950" data-testid="scan-exam">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Active exam</h2>
            {template ? (
              <p className="text-sm">
                <span className="font-medium">{template.title || "Untitled exam"}</span>
                <span className="block text-xs text-zinc-500">{template.questionCount} questions · {template.pages.length} page{template.pages.length === 1 ? "" : "s"}</span>
              </p>
            ) : (
              <p className="text-sm text-zinc-500">No exam yet. Design one in <b>1 · Design</b> and it appears here.</p>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex gap-1" role="tablist">
              {(["upload", "camera"] as const).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => { setModeState(m); if (m === "camera") unlockAudio(); }}
                  className={`rounded-md px-3 py-1 text-sm ${mode === m ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
                  {m === "upload" ? "Upload photos" : "Camera"}
                </button>
              ))}
            </div>
            {mode === "upload" ? (
              <label className={`${btn} w-full cursor-pointer bg-indigo-600 py-2 text-white hover:bg-indigo-700 ${ready ? "" : "pointer-events-none opacity-40"}`}>
                Choose answer-sheet images…
                <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" disabled={!ready} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
              </label>
            ) : (
              <CameraPanel client={client.current} enabled={ready} rearmRef={rearm} onCapture={(bmp) => runScan(`camera ${new Date().toLocaleTimeString()}`, bmp)} />
            )}
          </div>

          <details className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" data-testid="advanced-scanner">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Advanced Scanner Settings</summary>
            <div className="space-y-3 border-t border-zinc-100 p-3 dark:border-zinc-800">
              <label className={`${btn} cursor-pointer border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`}>
                Load template JSON
                <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onTemplateFile(e.target.files?.[0])} />
              </label>
              {templateError && <p className="text-xs text-red-600">{templateError}</p>}
          <CalibrationDrawer
            tuning={tuning} onTuning={updateTuning} diagnostics={diagnostics} onDiagnostics={toggleDiagnostics}
            calibrationMode={calibrationMode} onCalibrationMode={setCalibrationMode}
          />

            </div>
          </details>

          {jobs.length > 0 && (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
              {jobs.map((j) => (
                <li key={j.id}>
                  <button type="button" onClick={() => setSelected(j.id)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${selected === j.id ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}>
                    <span className="min-w-0 flex-1 truncate">{j.name}</span>
                    <JobBadge job={j} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-w-0" id="scan-detail">
          {current ? <JobDetail job={current} template={template} diagnostics={diagnostics} tuning={tuning} onRescan={(j) => j.source && runScan(`${j.name} (rescan)`, j.source, { calibration: true })} /> : (
            <div className="grid h-full min-h-60 place-items-center rounded-lg border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
              <EmptyHero title="Scan an answer sheet">Choose photos or open the camera: the scan result and overlay appear here.</EmptyHero>
            </div>
          )}
        </section>
      </div>
      {session && <CloudKey onKey={(k) => { cloudKey.current = k; }} />}
      {banner !== null && (() => {
        const j = jobs.find((x) => x.id === banner);
        return j?.instant ? (
          <InstantBanner job={j} onNext={() => { setBanner(null); if (mode === "camera") rearm.current(); else fileInput.current?.click(); }}
            onInspect={() => { setBanner(null); setSelected(j.id); requestAnimationFrame(() => document.getElementById("scan-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}
            onClose={() => setBanner(null)} />
        ) : null;
      })()}
    </div>
  );
}

const CLOUD_LABEL: Record<NonNullable<Job["cloud"]>, string> = {
  uploading: "cloud …", stored: "cloud ✓", already_stored: "cloud ✓", duplicate_identical: "cloud ✓ (rescan)", conflict: "cloud: conflict", rejected: "cloud: wrong sheet", failed: "cloud: queued",
};

function JobBadge({ job }: { job: Job }) {
  return <span className="flex items-center gap-1">{job.calibration && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">calibration</span>}{job.cloud && <span data-testid="cloud-status" className={`text-[11px] ${job.cloud === "conflict" || job.cloud === "rejected" ? "text-amber-700" : job.cloud === "failed" ? "text-zinc-500" : "text-emerald-700"}`}>{CLOUD_LABEL[job.cloud]}</span>}<LocalBadge job={job} /></span>;
}

function LocalBadge({ job }: { job: Job }) {
  if (job.status === "error") return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">{job.error?.code}</span>;
  if (job.status !== "done") return <span className="text-[11px] text-zinc-500">{job.stage ?? job.status}…</span>;
  const n = job.result!.fields.conflicts.length;
  return n
    ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{n} to review</span>
    : <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">OK</span>;
}

function JobDetail({ job, template, diagnostics, tuning, onRescan }: { job: Job; template: OMRTemplate | null; diagnostics: boolean; tuning: ScanTuning; onRescan: (j: Job) => void }) {
  const r = job.result;
  const highlight = useMemo(() => new Set(r?.fields.conflicts.flatMap((c) => c.bubbleIds) ?? []), [r]);
  if (job.status === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
        <p className="font-semibold">{job.error?.code}</p>
        <p>{job.error?.message}</p>
      </div>
    );
  }
  if (!r) return <p className="text-sm text-zinc-500">Scanning {job.name}… {job.stage}</p>;
  const f = r.fields;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-2">
        <ReviewCanvas result={r} preview={job.preview ?? null} highlight={highlight} diagnostics={diagnostics} template={template} />
        {diagnostics && <DiagnosticsPanel job={job} result={r} template={template} tuning={tuning} onRescan={onRescan} />}
      </div>
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <dt className="text-zinc-500">Roll number</dt><dd className="font-mono">{f.rollNumber ?? f.rollDigits.map((d) => d ?? "?").join("") ?? "-"}</dd>
          <dt className="text-zinc-500">Exam set</dt><dd className="font-mono">{f.examSet ?? "-"}</dd>
          <dt className="text-zinc-500">Page</dt><dd>{r.pageIndex + 1}{r.qr.rotated180 ? " (was upside down)" : ""}</dd>
          {diagnostics && <><dt className="text-zinc-500">QR</dt><dd>{r.qr.matchesTemplate ? "matches template" : "not read"}</dd></>}
          {diagnostics && <><dt className="text-zinc-500">Ref. marks</dt><dd>{Math.round(r.markDetectRatio * 100)}% · max curl {Math.max(...r.referenceMarks.map((m) => m.offsetMm)).toFixed(1)} mm</dd><dt className="text-zinc-500">Time</dt><dd>{r.timingsMs.total} ms</dd></>}
        </dl>
        {f.conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="mb-1 font-medium text-amber-900 dark:text-amber-200">Needs review</p>
            <ul className="list-disc pl-5 text-amber-900 dark:text-amber-200">{f.conflicts.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
          </div>
        )}
        {r.warnings.length > 0 && <p className="text-xs text-zinc-500">{r.warnings.join(" · ")}</p>}
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Answers</p>
          <div className="grid grid-cols-5 gap-x-3 gap-y-1 font-mono text-xs">
            {f.answers.map((a) => (
              <span key={a.questionNumber} className={a.marked.length > 1 || a.uncertain ? "text-amber-700 dark:text-amber-300" : a.marked.length ? "" : "text-zinc-400"}>
                {a.questionNumber}:{a.labels.join("") || "–"}{a.uncertain ? "?" : ""}
              </span>
            ))}
          </div>
          {f.numeric.map((n) => <p key={n.questionNumber} className="mt-1 font-mono text-xs">Q{n.questionNumber} = {n.value ?? "–"}</p>)}
          {f.matrix.map((m) => <p key={m.questionNumber} className="mt-1 font-mono text-xs">Q{m.questionNumber}: {Object.entries(m.rows).map(([k, v]) => `${k}→${v.join("") || "–"}`).join("  ")}</p>)}
        </div>
      </div>
    </div>
  );
}

/**
 * Live camera: frame-dropping alignment preview, pre-capture guardrails (too dark / glare / hold
 * steady) from a 160-px luminance sample and corner stability across frames, optional torch.
 */
function CameraPanel({ client, enabled, onCapture, rearmRef }: { client: ScannerClient | null; enabled: boolean; onCapture: (b: ImageBitmap) => void; rearmRef: React.MutableRefObject<() => void> }) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<ScanTelemetry | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [quality, setQuality] = useState<FrameQuality | null>(null);
  const [stability, setStability] = useState<StabilityState | null>(null);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const track = useRef<MediaStreamTrack | null>(null);
  const [autoSnap, setAutoSnap] = useState(true);
  const autoRef = useRef(true);
  const gate = useRef(new AutoSnapGate());
  const captureRef = useRef(onCapture);
  captureRef.current = onCapture;
  useEffect(() => { const a = readAutoSnap(); setAutoSnap(a); autoRef.current = a; }, []);
  useEffect(() => { rearmRef.current = () => gate.current.rearm(); }, [rearmRef]);

  useEffect(() => {
    if (!enabled || !client) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    const tracker = new StabilityTracker();
    const sample = document.createElement("canvas");
    sample.width = 160;
    const sctx = sample.getContext("2d", { willReadFrequently: true })!;
    let lastSample = 0;
    let lastCorners: CornerPoints | null = null;
    let lastFrameSize = { width: 1, height: 1 };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const t = stream.getVideoTracks()[0];
        track.current = t;
        const caps = (t.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch({ supported: !!caps.torch, on: false });
      } catch (e) {
        setCamError(e instanceof Error ? e.message : String(e));
        return;
      }
      const measure = (v: HTMLVideoElement) => {
        // luminance / glare on a tiny copy of the frame (~0.2 ms), corners mapped into that space
        sample.height = Math.max(1, Math.round((160 * v.videoHeight) / Math.max(1, v.videoWidth)));
        sctx.drawImage(v, 0, 0, sample.width, sample.height);
        const px = sctx.getImageData(0, 0, sample.width, sample.height).data;
        const k = sample.width / Math.max(1, lastFrameSize.width);
        const c = lastCorners;
        setQuality(analyzeFrame(px, sample.width, sample.height, c ? [c.tl, c.tr, c.br, c.bl].map((p) => ({ x: p.x * k, y: p.y * k })) : null));
      };
      const tick = async () => {
        if (!alive) return;
        const v = video.current;
        if (v && v.readyState >= 2) {
          if (performance.now() - lastSample > 250) { lastSample = performance.now(); measure(v); }
          if (!client.isBusy) {
            const bmp = await createImageBitmap(v);
            const p = client.align(bmp);
            if (p) p.then(({ corners, telemetry, frameSize }) => {
              if (!alive) return;
              lastCorners = corners; lastFrameSize = frameSize;
              const st = tracker.push(corners);
              setStatus(telemetry); setStability(st); drawQuad(overlay.current, corners, frameSize);
              // Auto-Snap: corners aligned and steady → capture + grade, once per sheet
              const snap = gate.current.update({ aligned: !!corners, stable: st.stable, now: performance.now(), busy: client.isBusy });
              if (snap && autoRef.current && video.current) createImageBitmap(video.current).then((b) => captureRef.current(b)).catch(() => {});
              else if (snap) gate.current.rearm();
            }).catch(() => {});
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
  }, [client, enabled]);

  async function toggleTorch() {
    const t = track.current;
    if (!t) return;
    const on = !torch.on;
    try { await t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }); setTorch((s) => ({ ...s, on })); } catch { setCamError("This camera could not switch the torch."); }
  }

  const aligned = status?.status === "aligned";
  const g = guidance(quality, stability);
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md bg-black">
        <video ref={video} playsInline muted className="block h-auto w-full" />
        <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" />
        <CornerBrackets locked={aligned} steady={!!stability?.stable} />
        {g.messages.length > 0 && (
          <div role="status" aria-live="polite" data-testid="camera-guardrails" className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 p-2">
            {g.messages.map((m, i) => (
              <span key={m} className={`rounded-full px-3 py-1 text-xs font-semibold shadow ${i === 0 && g.issues[0] !== "steady" ? "bg-amber-400 text-black" : "bg-black/70 text-white"}`}>{m}</span>
            ))}
          </div>
        )}
      </div>
      {camError && <p className="text-xs text-red-600">Camera unavailable: {camError}</p>}
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${aligned && g.ok ? "bg-emerald-100 text-emerald-700" : aligned ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}>
          {aligned ? (g.ok ? (autoSnap ? "Hold still: auto-snapping…" : `Ready · ${status?.frameTimeMs} ms`) : `Aligned · ${status?.frameTimeMs} ms`) : "Searching for the 4 corner squares…"}
        </span>
        {quality && <span className="font-mono text-[11px] text-zinc-400" title="mean luminance / clipped pixels">L{Math.round(quality.meanLuma)} · {Math.round(quality.saturatedFraction * 100)}%</span>}
        {torch.supported && <button type="button" aria-pressed={torch.on} className={`${btn} border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700`} onClick={toggleTorch}>{torch.on ? "Torch off" : "Torch"}</button>}
        <button type="button" role="switch" aria-checked={autoSnap} data-testid="autosnap-toggle" onClick={() => { const a = !autoSnap; setAutoSnap(a); autoRef.current = a; writeAutoSnap(a); unlockAudio(); if (a) gate.current.rearm(); }}
          title="Capture and grade automatically when all 4 corners hold steady"
          className={`${btn} ml-auto border px-2 py-1 text-xs ${autoSnap ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "border-zinc-300 dark:border-zinc-700"}`}>
          <span className={`inline-block h-3 w-6 rounded-full p-0.5 transition ${autoSnap ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}><span className={`block size-2 rounded-full bg-white transition ${autoSnap ? "translate-x-3" : ""}`} /></span>
          Auto-Snap
        </button>
        <button type="button" disabled={!aligned} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
          onClick={async () => { unlockAudio(); const v = video.current; if (v) { gate.current.update({ aligned: true, stable: true, now: performance.now() }); captureRef.current(await createImageBitmap(v)); } }}>
          Capture & scan
        </button>
      </div>
    </div>
  );
}

function drawQuad(c: HTMLCanvasElement | null, q: CornerPoints | null, size: { width: number; height: number }) {
  if (!c) return;
  c.width = size.width;
  c.height = size.height;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  if (!q) return;
  g.beginPath();
  [q.tl, q.tr, q.br, q.bl].forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.lineWidth = Math.max(3, size.width / 300);
  g.strokeStyle = "rgba(34,197,94,.95)";
  g.fillStyle = "rgba(34,197,94,.12)";
  g.fill();
  g.stroke();
}

// ------------------------------------------------------------------ field calibration
const range = "w-full accent-indigo-600";

function CalibrationDrawer({ tuning, onTuning, diagnostics, onDiagnostics, calibrationMode, onCalibrationMode }: {
  tuning: ScanTuning; onTuning: (t: Partial<ScanTuning>) => void; diagnostics: boolean; onDiagnostics: (on: boolean) => void; calibrationMode: boolean; onCalibrationMode: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const preset = TUNING_PRESETS.find((p) => p.tuning.inkLevel === tuning.inkLevel && p.tuning.fillCoverage === tuning.fillCoverage);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" data-testid="calibration-drawer">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Scanner calibration</span>
        {!isDefaultTuning(tuning) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{preset?.label ?? "custom"}</span>}
        {diagnostics && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">overlay on</span>}
        <span className="ml-auto text-zinc-400">{open ? "–" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-zinc-100 px-4 pb-4 pt-3 text-sm dark:border-zinc-800">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 accent-indigo-600" checked={diagnostics} onChange={(e) => onDiagnostics(e.target.checked)} />
            <span><b>Diagnostic overlay</b><span className="block text-xs text-zinc-500">Draws the 4 corner squares, the anti-curl reference bands and a ring on every bubble over the de-warped sheet.</span></span>
          </label>
          {diagnostics && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Overlay legend">
              {Object.values(RING_STYLE).map((r) => <li key={r.label} className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-2" style={{ borderColor: r.color }} />{r.label}</li>)}
              <li className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-blue-600" />Reference band</li>
            </ul>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 accent-indigo-600" checked={calibrationMode} onChange={(e) => onCalibrationMode(e.target.checked)} />
            <span><b>Calibration mode</b><span className="block text-xs text-zinc-500">Scans are analysed but <u>not</u> saved to the gradebook or uploaded: use it to benchmark test sheets safely.</span></span>
          </label>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Mark sensitivity</p>
            <div className="flex flex-wrap gap-1.5">
              {TUNING_PRESETS.map((p) => (
                <button key={p.id} type="button" title={p.hint} aria-pressed={preset?.id === p.id} onClick={() => onTuning(p.tuning)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${preset?.id === p.id ? "border-indigo-500 bg-indigo-50 font-medium text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200" : "border-zinc-300 dark:border-zinc-700"}`}>{p.label}</button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="flex justify-between text-xs"><span>Ink level (fill density threshold)</span><span className="font-mono">{tuning.inkLevel} <span className="text-zinc-400">(default {DEFAULT_TUNING.inkLevel})</span></span></span>
            <input type="range" className={range} aria-label="Ink level" {...TUNING_LIMITS.inkLevel} value={tuning.inkLevel} onChange={(e) => onTuning({ inkLevel: Number(e.target.value) })} />
            <span className="flex justify-between text-[11px] text-zinc-400"><span>← catches faint pencil</span><span>ignores light smudges →</span></span>
          </label>
          <label className="block">
            <span className="flex justify-between text-xs"><span>Fill coverage required</span><span className="font-mono">{Math.round(tuning.fillCoverage * 100)}% <span className="text-zinc-400">(default {Math.round(DEFAULT_TUNING.fillCoverage * 100)}%)</span></span></span>
            <input type="range" className={range} aria-label="Fill coverage" {...TUNING_LIMITS.fillCoverage} value={tuning.fillCoverage} onChange={(e) => onTuning({ fillCoverage: Number(e.target.value) })} />
          </label>
          {!isDefaultTuning(tuning) && <button type="button" className="text-xs text-indigo-600 underline" onClick={() => onTuning(DEFAULT_TUNING)}>Reset to tuned baseline</button>}
          <p className="text-xs text-zinc-500">Applies to the next scan. Open a photographed sheet below and use <i>Rescan with these settings</i> to compare.</p>
        </div>
      )}
    </div>
  );
}

function DiagnosticsPanel({ job, result, template, tuning, onRescan }: { job: Job; result: ScanOutput; template: OMRTemplate | null; tuning: ScanTuning; onRescan: (j: Job) => void }) {
  const s = useMemo(() => summarize(result), [result]);
  const advice = useMemo(() => advise(s), [s]);
  const used = job.tuning ?? DEFAULT_TUNING;
  const differs = used.inkLevel !== tuning.inkLevel || used.fillCoverage !== tuning.fillCoverage;
  function exportJson() {
    if (!template) return;
    const data = buildDiagnosticExport(template, result, used, { userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}` });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `diagnostic-${job.name.replace(/\W+/g, "_")}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const cell = (k: string, v: string) => <><dt className="text-zinc-500">{k}</dt><dd className="font-mono">{v}</dd></>;
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-sm dark:border-sky-500/30 dark:bg-sky-500/5" data-testid="diagnostics-panel">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300">Diagnostics</p>
        <span className="text-xs text-zinc-500">ink {used.inkLevel} · coverage {Math.round(used.fillCoverage * 100)}%</span>
        <div className="ml-auto flex gap-2">
          {job.source && <button type="button" className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" onClick={() => onRescan(job)}>{differs ? "Rescan with these settings" : "Rescan"}</button>}
          <button type="button" className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" onClick={exportJson}>Export JSON</button>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 text-xs">
        {cell("Confident fills", `${s.confident}`)}{cell("Doubtful", `${s.warning}`)}
        {cell("Empty", `${s.empty}`)}{cell("Contrast", s.contrast === null ? "—" : s.contrast.toFixed(2))}
        {cell("Filled density", s.meanFilledDensity === null ? "—" : s.meanFilledDensity.toFixed(2))}{cell("Empty density", s.meanEmptyDensity === null ? "—" : s.meanEmptyDensity.toFixed(2))}
        {cell("Ref. marks found", `${Math.round(s.markDetectRatio * 100)}%`)}{cell("Max curl", `${s.maxCurlMm} mm`)}
        {cell("Lowest fill conf.", s.lowestFilledConfidence === null ? "—" : s.lowestFilledConfidence.toFixed(2))}{cell("Scan time", `${s.totalMs} ms`)}
      </dl>
      {advice.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-sky-900 dark:text-sky-200">{advice.map((a) => <li key={a}>{a}</li>)}</ul>}
    </div>
  );
}

// ------------------------------------------------------------------ camera crosshairs
/** 4 target brackets at the viewfinder corners: white while searching, pulsing green once the 4 marks are found. */
function CornerBrackets({ locked, steady }: { locked: boolean; steady: boolean }) {
  const base = "pointer-events-none absolute size-10 border-4 transition-colors sm:size-12";
  const tone = locked ? `border-emerald-400 ${steady ? "" : "animate-pulse"} drop-shadow-[0_0_6px_rgba(52,211,153,.8)]` : "border-white/70";
  return (
    <div aria-hidden data-testid="corner-brackets" data-locked={locked} data-steady={steady}>
      <span className={`${base} ${tone} left-[5%] top-[7%] rounded-tl-xl border-b-0 border-r-0`} />
      <span className={`${base} ${tone} right-[5%] top-[7%] rounded-tr-xl border-b-0 border-l-0`} />
      <span className={`${base} ${tone} bottom-[7%] left-[5%] rounded-bl-xl border-r-0 border-t-0`} />
      <span className={`${base} ${tone} bottom-[7%] right-[5%] rounded-br-xl border-l-0 border-t-0`} />
    </div>
  );
}

// ------------------------------------------------------------------ instant result
function InstantBanner({ job, onNext, onInspect, onClose }: { job: Job; onNext: () => void; onInspect: () => void; onClose: () => void }) {
  const r = job.instant!;
  const good = r.keyed && r.percentage >= 75;
  return (
    <div role="status" aria-live="polite" data-testid="instant-result" className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-3xl p-2 sm:p-4">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950">
        <div className="h-1 bg-gradient-to-r from-indigo-600 via-gold to-indigo-600" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <dl className="grid grid-cols-2 gap-x-5 text-sm">
            <dt className="text-xs text-zinc-500">Student ID</dt><dt className="text-xs text-zinc-500">Set</dt>
            <dd className="font-mono text-lg font-semibold" data-testid="instant-roll">{r.rollNumber ?? "unreadable"}</dd>
            <dd className="font-mono text-lg font-semibold">{r.examSet ?? "–"}</dd>
          </dl>
          <div>
            <p className="text-xs text-zinc-500">Score</p>
            <p className={`text-2xl font-bold tabular-nums ${!r.keyed ? "text-zinc-500" : good ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-100"}`} data-testid="instant-score">{r.scoreText}{r.grade && r.keyed ? <span className="ml-2 text-sm font-semibold text-zinc-500">{r.grade}</span> : null}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Flagged</p>
            <p className={`text-lg font-semibold tabular-nums ${r.flagged ? "text-amber-600 dark:text-amber-400" : "text-zinc-700 dark:text-zinc-300"}`} data-testid="instant-flagged">{r.flagged}</p>
            <p className="text-[11px] text-zinc-500">{r.doubleMarked} double-marked · {r.blank} blank</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Dismiss result" className="ml-auto self-start rounded px-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button>
        </div>
        {!r.keyed && <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">Set the answer key on the Grade page and every scanned sheet is scored instantly.</p>}
        <div className="flex gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
          <button type="button" autoFocus onClick={onNext} className={`${btn} flex-1 bg-indigo-600 py-2 text-white hover:bg-indigo-700`}>Scan Next Sheet</button>
          <button type="button" onClick={onInspect} className={`${btn} flex-1 border border-zinc-300 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`}>Inspect Paper</button>
        </div>
      </div>
    </div>
  );
}

/** Live answer key of the selected cloud exam (rendered only when Convex is configured). */
function CloudKey({ onKey }: { onKey: (k: AnswerKey | null) => void }) {
  const session = useCloudSession();
  const examId = session?.isAuthenticated && session.me ? session.selection.examId : null;
  const doc = useQuery(api.grading.getAnswerKey, examId ? { examId } : "skip");
  useEffect(() => {
    onKey(doc && examId ? bodyToAnswerKey(doc, { examId, version: doc.version, layoutHash: session?.selection.layoutHash ?? undefined }) : null);
  }, [doc, examId, session?.selection.layoutHash, onKey]);
  return null;
}
