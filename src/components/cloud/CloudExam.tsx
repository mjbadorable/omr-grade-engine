"use client";
/**
 * Live data for the selected cloud exam (typed Convex hooks). Every field below is a reactive
 * subscription: when any teacher scans a sheet, saves a key version or corrects a mark, all
 * connected /grade pages receive the change and rescore locally.
 */
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type AnswerKeyBody, answerKeyToBody, bodyToAnswerKey, expandReadouts, overrideRowToPatch, resolutionRowToDomain } from "@/lib/cloud/convert";
import type { AnswerKey } from "@/lib/grading/types";
import type { OMRTemplate } from "@/lib/omr/schema";
import type { ManualOverridePatch } from "@/lib/review/overrides";
import type { ExamPeriod, Syllabus } from "@/lib/syllabus/types";
import type { Roster } from "@/lib/roster/schema";
import type { StoredScan } from "@/lib/storage/scan-store";
import type { ConflictResolution } from "@/lib/sync/types";
import { canonicalFrame, mmToCanonical } from "@/lib/vision/geometry";
import { bubbleRefs } from "@/lib/vision/read-bubbles";
import type { DecodedFields } from "@/lib/vision/types";
import type { ScanOutput } from "@/lib/vision/scan-sheet";
import { useCloudSession } from "./CloudSession";

export interface CloudScanRow {
  _id: Id<"scans">;
  fields: DecodedFields;
  deviceId: string;
  scannedByTeacherId: Id<"users">;
  scanTimestamp: number;
  studentRollNumber: string | null;
}

export interface CloudExamValue {
  examId: Id<"exams">;
  name: string;
  role: string;
  /** syllabus the exam is bound to (OBE attainment is measured against it) */
  syllabus: Syllabus | null | undefined;
  examPeriod: ExamPeriod | null;
  template: OMRTemplate;
  key: AnswerKey | undefined;
  scans: CloudScanRow[] | undefined;
  loadingScans: boolean;
  patches: ManualOverridePatch[];
  resolutions: ConflictResolution[];
  roster: Roster | null | undefined;
  analytics: { status: "pending" | "current" | "stale"; kr20: number | null; mean: number | null; gradedCount: number; openConflicts: number; keyVersion: number | null } | undefined;
  /**
   * Queue a key save (durable, survives offline) and send it when possible. `queued` = not on the
   * server yet; a concurrent edit by another teacher is merged on replay, never overwritten.
   */
  saveKey: (key: AnswerKey, baseVersion: number) => Promise<{ ok: true; version: number; queued?: boolean } | { ok: false; currentVersion: number }>;
  addPatches: (patches: ManualOverridePatch[]) => Promise<void>;
  resolve: (rollKey: string, keepScanId: string, supersededScanIds?: string[]) => Promise<void>;
  setRoster: (r: Roster) => Promise<void>;
  /** scan image + per-bubble readouts for the review modal */
  loadScanDetail: (scanId: string) => Promise<StoredScan | null>;
}

const Ctx = createContext<CloudExamValue | null>(null);
/** null outside cloud mode or when no exam is selected */
export const useCloudExam = () => useContext(Ctx);

export function CloudExamProvider({ children }: { children: ReactNode }) {
  const session = useCloudSession();
  const examId = session?.isAuthenticated && session.me ? session.selection.examId : null;
  const args = examId ? { examId } : "skip";
  const exam = useQuery(api.exams.get, args);
  const syllabusId = exam?.exam.syllabusId;
  const syllabus = useQuery(api.syllabi.get, syllabusId ? { syllabusId } : "skip");
  const keyDoc = useQuery(api.grading.getAnswerKey, args);
  const overrides = useQuery(api.grading.listOverrides, args);
  const resolutions = useQuery(api.grading.listResolutions, args);
  const roster = useQuery(api.exams.getRoster, args);
  const analytics = useQuery(api.grading.getExamAnalytics, args);
  const feed = usePaginatedQuery(api.grading.listScans, args, { initialNumItems: 500 });
  useEffect(() => { if (feed.status === "CanLoadMore") feed.loadMore(500); }, [feed]);

  const convex = useConvex();
  const sync = session?.sync;
  const setRosterM = useMutation(api.exams.setRoster);

  const template = session?.examTemplate ?? null;
  const layoutHash = template?.layoutHash ?? "";
  // Optimistic overlay: what this device has queued but the server has not acknowledged yet.
  const queued = useMemo(() => (sync?.pendingOps ?? []).filter((o) => o.examId === examId), [sync?.pendingOps, examId]);
  const queuedKey = useMemo(() => {
    const ops = queued.filter((o) => o.kind === "UPDATE_ANSWER_KEY");
    return ops.length ? (ops[ops.length - 1].payload as { key: AnswerKeyBody }).key : null;
  }, [queued]);
  const key = useMemo(() => {
    if (!keyDoc || !examId) return undefined;
    // keep the server's version number so edits made on top of it keep the right base
    return bodyToAnswerKey(queuedKey ?? keyDoc, { examId, version: keyDoc.version, layoutHash });
  }, [keyDoc, queuedKey, examId, layoutHash]);
  const patches = useMemo(() => {
    const server = (overrides ?? []).map((o) => overrideRowToPatch(o));
    const have = new Set(server.map((p) => p.id));
    const local = queued.filter((o) => o.kind === "APPLY_OVERRIDE").flatMap((o) => (o.payload as { patches: { patchId: string; scanId: string; target: ManualOverridePatch["target"]; questionNumber: number; originalState: ManualOverridePatch["originalState"]; overriddenOption: ManualOverridePatch["overriddenOption"]; reason: string; timestamp: number }[] }).patches)
      .filter((p) => !have.has(p.patchId)).map((p): ManualOverridePatch => ({ id: p.patchId, sheetId: p.scanId, target: p.target, questionNumber: p.questionNumber, originalState: p.originalState, overriddenOption: p.overriddenOption, reason: p.reason, timestamp: p.timestamp, teacherId: session?.me?._id ?? "me" }));
    return [...server, ...local];
  }, [overrides, queued, session?.me?._id]);
  const res = useMemo(() => {
    const server = (resolutions ?? []).map((r) => resolutionRowToDomain(r, layoutHash));
    const local = queued.filter((o) => o.kind === "RESOLVE_CONFLICT").map((o): ConflictResolution => {
      const p = o.payload as { rollKey: string; keepScanId: string; supersededScanIds: string[] };
      return { id: o.id, layoutHash, rollKey: p.rollKey, keepSheetId: p.keepScanId, supersededSheetIds: p.supersededScanIds, teacherId: session?.me?._id ?? "me", timestamp: o.ts };
    });
    return [...server, ...local];
  }, [resolutions, queued, layoutHash, session?.me?._id]);
  const scans = useMemo(() => (feed.status === "LoadingFirstPage" ? undefined : (feed.results as CloudScanRow[])), [feed.status, feed.results]);

  const saveKey = useCallback<CloudExamValue["saveKey"]>(async (k, baseVersion) => {
    if (!sync || !examId) throw new Error("Cloud session is not ready.");
    // the body the teacher started from, so a replay can merge three ways if someone else saved meanwhile
    const base = keyDoc && keyDoc.version === baseVersion ? (JSON.parse(JSON.stringify({ questions: keyDoc.questions, sets: keyDoc.sets, defaultSet: keyDoc.defaultSet, gradeBands: keyDoc.gradeBands, conflictPolicy: keyDoc.conflictPolicy })) as AnswerKeyBody) : null;
    const op = await sync.enqueue("UPDATE_ANSWER_KEY", examId, { baseVersion, base, key: answerKeyToBody(k) });
    const report = await sync.drain();
    const done = (report?.results.get(op.id) as { version: number } | undefined)?.version;
    return done ? { ok: true, version: done } : { ok: true, version: baseVersion, queued: true };
  }, [sync, examId, keyDoc]);

  const loadScanDetail = useCallback(async (scanId: string): Promise<StoredScan | null> => {
    if (!template) return null;
    const s = await convex.query(api.grading.getScan, { scanId: scanId as Id<"scans"> });
    if (!s) return null;
    const page = template.pages[s.pageIndex] ?? template.pages[0];
    const frame = canonicalFrame(template);
    const refs = new Map(bubbleRefs(page).map((r) => [r.id, r]));
    // the server keeps compact readouts; positions come from the template (global warp, no curl offsets)
    const bubbles = expandReadouts(page, s.rawBubbleReadouts).map((b) => {
      const ref = refs.get(b.bubbleId)!;
      return { ...b, center: mmToCanonical(frame, ref.centerMm[0], ref.centerMm[1]), coverage: 0, adjustedDensity: 0 };
    });
    const preview = s.previewUrl ? await fetch(s.previewUrl).then((r) => (r.ok ? r.blob() : null)).catch(() => null) : null;
    const result = { fields: s.fields, bubbles, layoutHash: s.layoutHash, templateId: template.templateId, pageIndex: s.pageIndex, canonical: { widthPx: frame.widthPx, heightPx: frame.heightPx, pxPerMm: frame.pxPerMm, padMm: frame.padMm }, referenceMarks: [] } as unknown as ScanOutput;
    return { sheetId: s._id, layoutHash: s.layoutHash, templateId: template.templateId, name: `scan ${new Date(s.scanTimestamp).toLocaleString()}`, createdAt: s.scanTimestamp, result, preview, deviceId: s.deviceId, teacherId: s.scannedByTeacherId };
  }, [convex, template]);

  const value = useMemo<CloudExamValue | null>(() => {
    if (!examId || !exam || !template) return null;
    const snap = analytics && "snapshot" in analytics ? analytics.snapshot : null;
    return {
      examId, name: exam.exam.name, role: exam.role, template,
      syllabus: syllabusId ? (syllabus as Syllabus | null | undefined) : null, examPeriod: exam.exam.examPeriod ?? null, key, scans, loadingScans: feed.status === "LoadingMore" || feed.status === "LoadingFirstPage",
      patches, resolutions: res, roster,
      analytics: analytics ? { status: analytics.status, kr20: snap?.kr20 ?? null, mean: snap?.mean ?? null, gradedCount: snap?.gradedCount ?? 0, openConflicts: snap?.openConflicts ?? 0, keyVersion: snap?.keyVersion ?? null } : undefined,
      saveKey,
      addPatches: async (ps) => {
        if (!sync) throw new Error("Cloud session is not ready.");
        if (ps.some((p) => !p.reason.trim())) throw new Error("Every correction needs a reason for the audit log.");   // same rule as the server, checked before queueing
        await sync.enqueue("APPLY_OVERRIDE", examId, { patches: ps.map((p) => ({ patchId: p.id, scanId: p.sheetId, target: p.target, questionNumber: p.questionNumber, originalState: JSON.parse(JSON.stringify(p.originalState)), overriddenOption: p.overriddenOption, reason: p.reason, timestamp: p.timestamp })) });
        void sync.drain();
      },
      resolve: async (rollKey, keepScanId, supersededScanIds = []) => {
        if (!sync) throw new Error("Cloud session is not ready.");
        await sync.enqueue("RESOLVE_CONFLICT", examId, { rollKey, keepScanId, supersededScanIds, layoutHash });
        void sync.drain();
      },
      setRoster: async (r) => { await setRosterM({ examId, roster: r }); },
      loadScanDetail,
    };
  }, [examId, exam, syllabus, syllabusId, template, key, scans, feed.status, patches, res, roster, analytics, saveKey, sync, layoutHash, setRosterM, loadScanDetail]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
