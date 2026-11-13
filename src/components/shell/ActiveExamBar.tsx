"use client";
/**
 * Active exam selector + auto-sync status. One exam follows the teacher from Design to Scan to
 * Grade: the sheet designed on this device is saved to the shared workspace automatically once it
 * is printed, scanned or graded, so nobody has to open a "choose exam" menu.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCloudSession } from "@/components/cloud/CloudSession";
import SyncBadge from "@/components/cloud/SyncBadge";
import { type ActiveExam, resolveActiveExam, SHEET_PRINTED_EVENT, shouldAutoSave, TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import { OMRTemplateSchema, type OMRTemplate } from "@/lib/omr/schema";
import { readStoredPlan } from "@/lib/syllabus/plan-store";
import { readStoredTemplate } from "@/lib/storage/template-store";

function useLocalSheet(): OMRTemplate | null {
  const path = usePathname();
  const [t, setT] = useState<OMRTemplate | null>(null);
  useEffect(() => {
    const read = () => { const x = readStoredTemplate(); setT((cur) => (cur?.layoutHash === x?.layoutHash && cur?.title === x?.title ? cur : x)); };
    read();
    window.addEventListener(TEMPLATE_CHANGED_EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(TEMPLATE_CHANGED_EVENT, read); window.removeEventListener("storage", read); };
  }, [path]);
  return t;
}

export default function ActiveExamBar({ fill = false }: { fill?: boolean }) {
  const s = useCloudSession();
  const path = usePathname();
  const local = useLocalSheet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [printed, setPrinted] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const ref = useRef<HTMLDivElement>(null);

  const signedIn = !!s?.isAuthenticated && !!s.me;
  const exams = s?.exams;
  const active: ActiveExam = resolveActiveExam({
    exams: exams?.map((e) => ({ _id: e._id, name: e.name, layoutHash: e.layoutHash })),
    selectedExamId: s?.selection.examId ?? null,
    local: local ? { title: local.title || local.templateId, layoutHash: local.layoutHash } : null,
  });

  // a sheet that was just printed / downloaded is "final": save it
  useEffect(() => {
    const h = (e: Event) => setPrinted((e as CustomEvent<string>).detail ?? null);
    window.addEventListener(SHEET_PRINTED_EVENT, h);
    return () => window.removeEventListener(SHEET_PRINTED_EVENT, h);
  }, []);
  // while the teacher keeps designing, a different layout than the selected exam means a NEW exam is in progress
  useEffect(() => {
    const h = () => {
      const t = readStoredTemplate();
      if (s?.selection.examId && t && s.selection.layoutHash && t.layoutHash !== s.selection.layoutHash) s.selectExam(null);
    };
    window.addEventListener("veritas:design-edited", h);
    return () => window.removeEventListener("veritas:design-edited", h);
  }, [s]);

  const saveDraft = useCallback(async (t: OMRTemplate) => {
    if (!s) return;
    inFlight.current.add(t.layoutHash);
    setErr(null);
    try {
      const plan = readStoredPlan();
      const linked = plan && plan.templateId === t.templateId && plan.tos.totalQuestions === t.questionCount ? plan : null;
      await s.createExam(t.title || t.templateId, t, linked);
    } catch (e) {
      inFlight.current.delete(t.layoutHash);
      setErr((e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? String(e));
    }
  }, [s]);

  // bind: matched sheet → select; draft → save when the teacher reaches Scan / Grade or prints it
  useEffect(() => {
    if (!s || !signedIn) return;
    if (active.kind === "match" && s.selection.examId !== active.exam._id) s.selectExam(active.exam._id as never);
    if (active.kind === "draft" && local && shouldAutoSave({ active, signedIn, role: s.workspace.role, path, printedHash: printed, inFlight: inFlight.current, examsLoaded: exams !== undefined })) {
      const parsed = OMRTemplateSchema.safeParse(local);
      if (parsed.success) void saveDraft(parsed.data);
    }
  }, [s, signedIn, active, local, path, printed, exams, saveDraft]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const label = active.kind === "cloud" || active.kind === "match" ? active.exam.name : active.kind === "draft" ? active.title : "No exam yet";
  const status = !s ? "Saved on this device" : !signedIn ? "Draft · sign in to sync" : s.workspace.access !== "member" && s.workspace.access !== "loading" ? "Faculty access required" : active.kind === "draft" ? (err ? "Not saved" : "Saving on Scan / Grade") : active.kind === "none" ? "Design a sheet to begin" : "Synced workspace";

  return (
    <div className={`flex min-w-0 items-center gap-2 ${fill ? "w-full" : ""}`} data-testid="active-exam-bar">
      <div className={`relative min-w-0 ${fill ? "flex-1" : ""}`} ref={ref}>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="active-exam" title={`${label} · ${err ?? status}`}
          className={`flex items-center gap-1.5 rounded-full ${fill ? "w-full" : "max-w-[200px]"} border border-zinc-200 bg-white px-2.5 py-1.5 text-left text-xs hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-950`}>
          <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6" /></svg>
          <span className={`min-w-0 flex-1 truncate font-semibold ${err ? "text-red-600" : ""}`} data-testid="active-exam-name">{label}</span>
          <span className="shrink-0 text-zinc-400" aria-hidden>▾</span>
        </button>
        {open && (
          <div className="absolute left-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] space-y-2 rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Active exam</p>
            {local && (
              <button type="button" className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${s?.selection.examId ? "" : "bg-indigo-50 dark:bg-indigo-500/10"}`}
                onClick={() => { s?.selectExam(null); setOpen(false); }}>
                <span className="block truncate font-medium">{local.title || local.templateId}</span><span className="block text-[11px] text-zinc-500">Sheet on this device{active.kind === "draft" ? " · not saved yet" : ""}</span>
              </button>
            )}
            {s && signedIn && (exams?.length ?? 0) > 0 && <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Saved exams</p>}
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {exams?.map((e) => (
                <li key={e._id}>
                  <button type="button" className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${s?.selection.examId === e._id ? "bg-indigo-50 dark:bg-indigo-500/10" : ""}`}
                    onClick={() => { s?.selectExam(e._id); setOpen(false); }}>
                    <span className="block truncate font-medium">{e.name}</span><span className="block text-[11px] text-zinc-500">key v{e.currentKeyVersion}{e.examPeriod ? ` · ${e.examPeriod.toLowerCase()}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!local && !(exams?.length) && <p className="px-2 py-3 text-xs text-zinc-500">No exam yet. Open <b>Design Exam</b>, name your exam and configure the sheet; it follows you to Scan and Grade.</p>}
            {err && local && active.kind === "draft" && <button type="button" className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => { const p = OMRTemplateSchema.safeParse(local); if (p.success) void saveDraft(p.data); }}>Retry saving to workspace</button>}
          </div>
        )}
      </div>
      <SyncBadge compact />
    </div>
  );
}
