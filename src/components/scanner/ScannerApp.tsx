"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OMRTemplateSchema, type OMRTemplate } from "@/lib/omr/schema";
import type { ScanOutput } from "@/lib/vision/scan-sheet";
import { ScannerClient } from "@/lib/vision/scanner-client";
import type { CornerPoints, ScanTelemetry, VisionErrorPayload } from "@/lib/vision/types";
import ReviewCanvas from "./ReviewCanvas";

export const TEMPLATE_STORAGE_KEY = "omr:template";

interface Job {
  id: number;
  name: string;
  status: "queued" | "scanning" | "done" | "error";
  stage?: string;
  result?: ScanOutput;
  preview?: ImageBitmap | null;
  error?: VisionErrorPayload;
}

const btn = "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

function readStoredTemplate(): OMRTemplate | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return null;
    const p = OMRTemplateSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

export default function ScannerApp() {
  const client = useRef<ScannerClient | null>(null);
  const [engine, setEngine] = useState<{ state: "loading" | "ready" | "error"; ms?: number; message?: string }>({ state: "loading" });
  const [template, setTemplate] = useState<OMRTemplate | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [mode, setMode] = useState<"upload" | "camera">("upload");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const jobSeq = useRef(0);

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

  const runScan = useCallback(async (name: string, source: Blob | ImageBitmap) => {
    const id = ++jobSeq.current;
    setJobs((js) => [{ id, name, status: "queued" }, ...js]);
    setSelected(id);
    try {
      patchJob(id, { status: "scanning" });
      const { result, preview } = await client.current!.scan(source, { onTelemetry: (t) => patchJob(id, { stage: t.stage }) });
      patchJob(id, { status: "done", result, preview });
    } catch (e) {
      patchJob(id, { status: "error", error: e as VisionErrorPayload });
    }
  }, [patchJob]);

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
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(parsed.data));
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : String(e));
    }
  }

  const current = jobs.find((j) => j.id === selected) ?? null;
  const ready = engine.state === "ready" && !!template;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-[15px] font-semibold tracking-tight">OMR Scanner</h1>
        <Link href="/" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Designer</Link>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${engine.state === "ready" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : engine.state === "error" ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
          {engine.state === "ready" ? `Vision engine ready · ${engine.ms} ms` : engine.state === "error" ? `Engine failed: ${engine.message}` : "Loading vision engine (OpenCV, cached after first use)…"}
        </span>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[380px_1fr]">
        <section className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Template</h2>
            {template ? (
              <p className="text-sm">
                <span className="font-medium">{template.title || template.templateId}</span>
                <span className="ml-2 font-mono text-xs text-zinc-500">{template.templateId} · v{template.version} · #{template.layoutHash}</span>
                <span className="block text-xs text-zinc-500">{template.questionCount} questions · {template.pages.length} page(s)</span>
              </p>
            ) : (
              <p className="text-sm text-zinc-500">No template yet. Design one, or load a <code>template-coordinates.json</code>.</p>
            )}
            <label className={`${btn} mt-3 cursor-pointer border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`}>
              Load template JSON
              <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onTemplateFile(e.target.files?.[0])} />
            </label>
            {templateError && <p className="mt-2 text-xs text-red-600">{templateError}</p>}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex gap-1" role="tablist">
              {(["upload", "camera"] as const).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1 text-sm ${mode === m ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
                  {m === "upload" ? "Upload photos" : "Camera"}
                </button>
              ))}
            </div>
            {mode === "upload" ? (
              <label className={`${btn} w-full cursor-pointer bg-indigo-600 py-2 text-white hover:bg-indigo-500 ${ready ? "" : "pointer-events-none opacity-40"}`}>
                Choose answer-sheet images…
                <input type="file" accept="image/*" multiple className="sr-only" disabled={!ready} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
              </label>
            ) : (
              <CameraPanel client={client.current} enabled={ready} onCapture={(bmp) => runScan(`camera ${new Date().toLocaleTimeString()}`, bmp)} />
            )}
          </div>

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

        <section className="min-w-0">
          {current ? <JobDetail job={current} /> : (
            <div className="grid h-full min-h-60 place-items-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500 dark:border-zinc-700">
              Scan results appear here.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function JobBadge({ job }: { job: Job }) {
  if (job.status === "error") return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">{job.error?.code}</span>;
  if (job.status !== "done") return <span className="text-[11px] text-zinc-500">{job.stage ?? job.status}…</span>;
  const n = job.result!.fields.conflicts.length;
  return n
    ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{n} to review</span>
    : <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">OK</span>;
}

function JobDetail({ job }: { job: Job }) {
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
      <ReviewCanvas result={r} preview={job.preview ?? null} highlight={highlight} />
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <dt className="text-zinc-500">Roll number</dt><dd className="font-mono">{f.rollNumber ?? f.rollDigits.map((d) => d ?? "?").join("") ?? "-"}</dd>
          <dt className="text-zinc-500">Exam set</dt><dd className="font-mono">{f.examSet ?? "-"}</dd>
          <dt className="text-zinc-500">Page</dt><dd>{r.pageIndex + 1}{r.qr.rotated180 ? " (was upside down)" : ""}</dd>
          <dt className="text-zinc-500">QR</dt><dd>{r.qr.matchesTemplate ? "matches template" : "not read"}</dd>
          <dt className="text-zinc-500">Ref. marks</dt><dd>{Math.round(r.markDetectRatio * 100)}% · max curl {Math.max(...r.referenceMarks.map((m) => m.offsetMm)).toFixed(1)} mm</dd>
          <dt className="text-zinc-500">Time</dt><dd>{r.timingsMs.total} ms</dd>
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

/** Live camera: frame-dropping alignment preview, manual capture. */
function CameraPanel({ client, enabled, onCapture }: { client: ScannerClient | null; enabled: boolean; onCapture: (b: ImageBitmap) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<ScanTelemetry | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !client) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
      } catch (e) {
        setCamError(e instanceof Error ? e.message : String(e));
        return;
      }
      const tick = async () => {
        if (!alive) return;
        const v = video.current;
        if (v && v.readyState >= 2 && !client.isBusy) {
          const bmp = await createImageBitmap(v);
          const p = client.align(bmp);
          if (p) p.then(({ corners, telemetry, frameSize }) => { if (alive) { setStatus(telemetry); drawQuad(overlay.current, corners, frameSize); } }).catch(() => {});
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [client, enabled]);

  const aligned = status?.status === "aligned";
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md bg-black">
        <video ref={video} playsInline muted className="block h-auto w-full" />
        <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      {camError && <p className="text-xs text-red-600">Camera unavailable: {camError}</p>}
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${aligned ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
          {aligned ? `Aligned · ${status?.frameTimeMs} ms` : "Searching for the 4 corner squares…"}
        </span>
        <button type="button" disabled={!aligned} className={`${btn} ml-auto bg-indigo-600 text-white hover:bg-indigo-500`}
          onClick={async () => { const v = video.current; if (v) onCapture(await createImageBitmap(v)); }}>
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
