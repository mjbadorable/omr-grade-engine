/**
 * Analytics snapshot job. Convex queries have per-call read limits, so a large exam's item
 * analysis cannot be computed inside one query. Instead this action pages through all scans,
 * runs the same pure scorer / item-analysis code as the browser, and stores a snapshot that
 * `grading.getExamAnalytics` serves reactively. Snapshots only move forward in revision.
 */
import { v } from "convex/values";
import { bodyToAnswerKey, type AnswerKeyBody } from "../src/lib/cloud/convert";
import { analyzeItems } from "../src/lib/grading/item-analysis";
import { rescoreBatch } from "../src/lib/grading/scorer";
import { applyOverrides } from "../src/lib/review/overrides";
import { detectConflicts, sheetDisposition, type SyncedSheet } from "../src/lib/sync/conflicts";
import type { DecodedFields } from "../src/lib/vision/types";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

const PAGE = 400;

interface ScanRow { _id: Id<"scans">; fields: DecodedFields; deviceId: string; teacherId: Id<"users">; createdAt: number }
interface ScanPageResult { isDone: boolean; continueCursor: string; page: ScanRow[] }

type StateResult = { exam: Doc<"exams">; key: Doc<"answerKeys"> | null; overrides: Doc<"overrides">[]; resolutions: Doc<"conflictResolutions">[] } | null;

export const examState = internalQuery({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }): Promise<StateResult> => {
    const exam = await ctx.db.get(examId);
    if (!exam) return null;
    const key = await ctx.db.query("answerKeys").withIndex("by_exam_version", (q) => q.eq("examId", examId).eq("version", exam.currentKeyVersion)).unique();
    const overrides = await ctx.db.query("overrides").withIndex("by_exam", (q) => q.eq("examId", examId)).collect();
    const resolutions = await ctx.db.query("conflictResolutions").withIndex("by_exam", (q) => q.eq("examId", examId)).collect();
    return { exam, key, overrides, resolutions };
  },
});

export const scanPage = internalQuery({
  args: { examId: v.id("exams"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { examId, cursor }): Promise<ScanPageResult> => {
    const res = await ctx.db.query("scans").withIndex("by_exam", (q) => q.eq("examId", examId)).paginate({ numItems: PAGE, cursor });
    return {
      isDone: res.isDone,
      continueCursor: res.continueCursor,
      page: res.page.map((s) => ({ _id: s._id, fields: s.fields as DecodedFields, deviceId: s.deviceId, teacherId: s.scannedByTeacherId, createdAt: s.scanTimestamp })),
    };
  },
});

export const recompute = internalAction({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }): Promise<void> => {
    const state: StateResult = await ctx.runQuery(internal.analytics.examState, { examId });
    if (!state?.key) return;
    const { exam, key, overrides, resolutions } = state;
    const scans: ScanRow[] = [];
    let cursor: string | null = null;
    for (;;) {
      const res: ScanPageResult = await ctx.runQuery(internal.analytics.scanPage, { examId, cursor });
      scans.push(...res.page);
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    const answerKey = bodyToAnswerKey(key as unknown as AnswerKeyBody, { examId, version: key.version, layoutHash: exam.layoutHash });
    const bySheet = new Map<string, typeof overrides>();
    for (const o of overrides) (bySheet.get(o.scanId) ?? bySheet.set(o.scanId, []).get(o.scanId)!).push(o);
    const effective: SyncedSheet[] = scans.map((s) => ({
      sheetId: s._id, layoutHash: exam.layoutHash, deviceId: s.deviceId, teacherId: s.teacherId, createdAt: s.createdAt,
      fields: applyOverrides(s.fields as DecodedFields, (bySheet.get(s._id) ?? []).map((o) => ({
        id: o.patchId, sheetId: o.scanId, target: o.target, questionNumber: o.questionNumber, originalState: o.originalState,
        overriddenOption: o.overriddenOption, reason: o.reason, timestamp: o.timestamp, teacherId: o.teacherId,
      }))),
    }));
    const groups = detectConflicts(effective, resolutions.map((r) => ({
      id: r._id, layoutHash: exam.layoutHash, rollKey: r.rollKey, keepSheetId: r.keepScanId, supersededSheetIds: r.supersededScanIds, teacherId: r.teacherId, timestamp: r.timestamp,
    })));
    const disp = sheetDisposition(groups);
    const counted = effective.filter((s) => { const d = disp.get(s.sheetId); return d !== "duplicate" && d !== "superseded"; });
    const sheets = rescoreBatch(counted.map((s) => ({ sheetId: s.sheetId, fields: s.fields })), answerKey);
    const report = analyzeItems(sheets, answerKey);
    await ctx.runMutation(internal.analytics.storeSnapshot, {
      examId, revision: exam.revision, keyVersion: key.version, scanCount: scans.length, gradedCount: sheets.length,
      openConflicts: groups.filter((g) => g.kind === "DIVERGENT_ANSWERS" && !g.resolution).length,
      mean: report.mean, sd: report.sd, kr20: report.kr20, sem: report.sem, report,
    });
  },
});

export const storeSnapshot = internalMutation({
  args: {
    examId: v.id("exams"), revision: v.number(), keyVersion: v.number(), scanCount: v.number(), gradedCount: v.number(), openConflicts: v.number(),
    mean: v.number(), sd: v.number(), kr20: v.union(v.number(), v.null()), sem: v.union(v.number(), v.null()), report: v.any(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("examAnalytics").withIndex("by_exam", (q) => q.eq("examId", a.examId)).unique();
    if (existing && existing.revision > a.revision) return; // a newer job already finished
    const doc = { ...a, computedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("examAnalytics", doc);
  },
});
