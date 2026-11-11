/**
 * Scan ingestion, answer-key versions, teacher overrides, conflict resolution and live analytics.
 *
 * Every mutation that can change a grade bumps `exam.revision` and schedules the analytics
 * snapshot job. Clients subscribed to `getAnswerKey` / `listScans` rescore locally the moment a
 * new key version or scan lands (Convex pushes query updates to every connected client).
 */
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { applyOverrides } from "../src/lib/review/overrides";
import { rollKey } from "../src/lib/roster/schema";
import { answerDigest } from "../src/lib/sync/conflicts";
import type { DecodedFields } from "../src/lib/vision/types";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { fail, requireExam } from "./lib/access";
import { answerKeyBody, compactReadouts, decodedFields, originalState, overriddenOption, overrideTarget } from "./validators";

const MAX_BATCH = 50;
const ANALYTICS_DELAY_MS = 1500;

async function bumpRevision(ctx: MutationCtx, exam: Doc<"exams">, patch: Partial<Doc<"exams">> = {}) {
  const revision = exam.revision + 1;
  await ctx.db.patch(exam._id, { ...patch, revision });
  await ctx.scheduler.runAfter(ANALYTICS_DELAY_MS, internal.analytics.recompute, { examId: exam._id });
  return revision;
}

async function overridePatchesFor(ctx: MutationCtx, scanId: Id<"scans">) {
  const rows = await ctx.db.query("overrides").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
  return rows.map((r) => ({ id: r.patchId, sheetId: r.scanId, target: r.target, questionNumber: r.questionNumber, originalState: r.originalState, overriddenOption: r.overriddenOption, reason: r.reason, timestamp: r.timestamp, teacherId: r.teacherId }));
}

// ------------------------------------------------------------------ uploads
export const generateUploadUrl = mutation({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    await requireExam(ctx, examId, "teacher");
    return ctx.storage.generateUploadUrl();
  },
});

// ------------------------------------------------------------------ scans
export type ScanSubmitResult =
  | { clientScanId: string; status: "stored" | "already_stored"; scanId: Id<"scans"> }
  | { clientScanId: string; status: "duplicate_identical" | "conflict"; scanId: Id<"scans">; with: Id<"scans">[] }
  | { clientScanId: string; status: "rejected"; reason: string };

/**
 * Ingest scanned sheets from the /scan worker. Idempotent per `clientScanId`. A sheet whose roll
 * number already has scans in this exam is compared on its effective answers (overrides
 * applied): identical → `duplicate_identical`, different → `conflict` (held for review; nothing is
 * overwritten).
 */
export const submitScanBatch = mutation({
  args: {
    examId: v.id("exams"),
    deviceId: v.string(),
    scans: v.array(v.object({
      clientScanId: v.string(),
      layoutHash: v.string(),
      pageIndex: v.number(),
      fields: decodedFields,
      rawBubbleReadouts: compactReadouts,
      confidence: v.number(),
      scanTimestamp: v.number(),
      previewStorageId: v.optional(v.id("_storage")),
    })),
  },
  handler: async (ctx, { examId, deviceId, scans }): Promise<ScanSubmitResult[]> => {
    const { exam, user } = await requireExam(ctx, examId, "teacher");
    if (exam.status === "closed") fail("EXAM_CLOSED", "This exam is closed for scanning.");
    if (scans.length > MAX_BATCH) fail("BATCH_TOO_LARGE", `Send at most ${MAX_BATCH} scans per call.`);
    const results: ScanSubmitResult[] = [];
    let stored = 0;
    for (const s of scans) {
      const dup = await ctx.db.query("scans").withIndex("by_client_id", (q) => q.eq("examId", examId).eq("clientScanId", s.clientScanId)).unique();
      if (dup) { results.push({ clientScanId: s.clientScanId, status: "already_stored", scanId: dup._id }); continue; }
      if (s.layoutHash !== exam.layoutHash) { results.push({ clientScanId: s.clientScanId, status: "rejected", reason: "TEMPLATE_MISMATCH" }); continue; }
      const key = rollKey(s.fields.rollNumber);
      const scanId = await ctx.db.insert("scans", {
        examId, clientScanId: s.clientScanId, layoutHash: s.layoutHash, pageIndex: s.pageIndex,
        studentRollNumber: s.fields.rollNumber, rollKey: key, examSet: s.fields.examSet,
        fields: s.fields, rawBubbleReadouts: s.rawBubbleReadouts, confidence: s.confidence,
        scanTimestamp: s.scanTimestamp, scannedByTeacherId: user._id, deviceId,
        ...(s.previewStorageId ? { previewStorageId: s.previewStorageId } : {}),
      });
      stored++;
      if (!key) { results.push({ clientScanId: s.clientScanId, status: "stored", scanId }); continue; }
      const others = (await ctx.db.query("scans").withIndex("by_exam_roll", (q) => q.eq("examId", examId).eq("rollKey", key)).collect()).filter((o) => o._id !== scanId);
      if (!others.length) { results.push({ clientScanId: s.clientScanId, status: "stored", scanId }); continue; }
      const mine = answerDigest(s.fields as DecodedFields);
      let divergent = false;
      for (const o of others) {
        const eff = applyOverrides(o.fields as DecodedFields, await overridePatchesFor(ctx, o._id));
        if (answerDigest(eff) !== mine) divergent = true;
      }
      results.push({ clientScanId: s.clientScanId, status: divergent ? "conflict" : "duplicate_identical", scanId, with: others.map((o) => o._id) });
    }
    if (stored) await bumpRevision(ctx, exam);
    return results;
  },
});

/** Live scan feed (paginated; the raw per-bubble readouts are omitted to keep pages small). */
export const listScans = query({
  args: { examId: v.id("exams"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { examId, paginationOpts }) => {
    await requireExam(ctx, examId, "viewer");
    const page = await ctx.db.query("scans").withIndex("by_exam", (q) => q.eq("examId", examId)).order("asc").paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map(({ rawBubbleReadouts: _r, ...rest }) => { void _r; return rest; }),
    };
  },
});

/** One scan with its per-bubble readouts and a short-lived image URL. */
export const getScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    await requireExam(ctx, scan.examId, "viewer");
    return { ...scan, previewUrl: scan.previewStorageId ? await ctx.storage.getUrl(scan.previewStorageId) : null };
  },
});

// ------------------------------------------------------------------ answer keys
/** Newest key version (or a specific one). */
export const getAnswerKey = query({
  args: { examId: v.id("exams"), version: v.optional(v.number()) },
  handler: async (ctx, { examId, version }) => {
    const { exam } = await requireExam(ctx, examId, "viewer");
    const want = version ?? exam.currentKeyVersion;
    return ctx.db.query("answerKeys").withIndex("by_exam_version", (q) => q.eq("examId", examId).eq("version", want)).unique();
  },
});

export const listKeyVersions = query({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    await requireExam(ctx, examId, "viewer");
    const keys = await ctx.db.query("answerKeys").withIndex("by_exam_version", (q) => q.eq("examId", examId)).order("desc").take(100);
    return keys.map((k) => ({ version: k.version, createdBy: k.createdBy, createdAt: k._creationTime }));
  },
});

/**
 * Store a new immutable key version. Optimistic concurrency: `baseVersion` must equal the current
 * version, otherwise KEY_VERSION_CONFLICT is thrown with the current version so the client can
 * rebase. The new version reaches every subscribed client immediately; they rescore locally and
 * the analytics snapshot is recomputed in the background.
 */
export const updateAnswerKey = mutation({
  args: { examId: v.id("exams"), baseVersion: v.number(), key: v.object(answerKeyBody) },
  handler: async (ctx, { examId, baseVersion, key }) => {
    const { exam, user } = await requireExam(ctx, examId, "teacher");
    if (baseVersion !== exam.currentKeyVersion)
      throw new ConvexError({ code: "KEY_VERSION_CONFLICT", message: "Someone saved a newer answer key.", currentVersion: exam.currentKeyVersion });
    const current = await ctx.db.query("answerKeys").withIndex("by_exam_version", (q) => q.eq("examId", examId).eq("version", exam.currentKeyVersion)).unique();
    if (current) {
      const a = Object.keys(current.questions).sort().join(), b = Object.keys(key.questions).sort().join();
      if (a !== b) fail("INVALID_KEY", "The key must contain exactly the exam's questions.");
    }
    for (const [n, r] of Object.entries(key.questions)) {
      if (String(r.questionNumber) !== n) fail("INVALID_KEY", `Question ${n} has mismatched number ${r.questionNumber}.`);
      if (r.points < 0 || r.negative < 0) fail("INVALID_KEY", `Question ${n}: points and penalties must be ≥ 0.`);
      if (r.type === "choice" && r.correct.some((o) => o < 0 || o >= r.optionCount)) fail("INVALID_KEY", `Question ${n}: correct option out of range.`);
    }
    const version = exam.currentKeyVersion + 1;
    await ctx.db.insert("answerKeys", { examId, version, ...key, createdBy: user._id });
    await bumpRevision(ctx, exam, { currentKeyVersion: version });
    return { version };
  },
});

// ------------------------------------------------------------------ overrides & conflicts
export const addOverrides = mutation({
  args: {
    examId: v.id("exams"),
    patches: v.array(v.object({
      patchId: v.string(),
      scanId: v.id("scans"),
      target: overrideTarget,
      questionNumber: v.number(),
      originalState,
      overriddenOption,
      reason: v.string(),
      timestamp: v.number(),
    })),
  },
  handler: async (ctx, { examId, patches }) => {
    const { exam, user } = await requireExam(ctx, examId, "teacher");
    let added = 0;
    for (const p of patches) {
      const scan = await ctx.db.get(p.scanId);
      if (!scan || scan.examId !== examId) fail("NOT_FOUND", "Scan does not belong to this exam.");
      if (!p.reason.trim()) fail("REASON_REQUIRED", "Every correction needs a reason for the audit log.");
      const exists = await ctx.db.query("overrides").withIndex("by_patch", (q) => q.eq("examId", examId).eq("patchId", p.patchId)).unique();
      if (exists) continue;
      // the teacher is always the caller: the audit trail cannot be forged by the client
      await ctx.db.insert("overrides", { examId, ...p, reason: p.reason.trim(), teacherId: user._id });
      added++;
    }
    if (added) await bumpRevision(ctx, exam);
    return { added };
  },
});

export const listOverrides = query({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    await requireExam(ctx, examId, "viewer");
    return ctx.db.query("overrides").withIndex("by_exam", (q) => q.eq("examId", examId)).collect();
  },
});

/** Pick the scan that counts for a student scanned more than once with different answers. */
export const resolveConflict = mutation({
  args: { examId: v.id("exams"), rollKey: v.string(), keepScanId: v.id("scans") },
  handler: async (ctx, { examId, rollKey: key, keepScanId }) => {
    const { exam, user } = await requireExam(ctx, examId, "teacher");
    const group = await ctx.db.query("scans").withIndex("by_exam_roll", (q) => q.eq("examId", examId).eq("rollKey", key)).collect();
    if (!group.some((s) => s._id === keepScanId)) fail("NOT_FOUND", "That scan is not part of this student's group.");
    const id = await ctx.db.insert("conflictResolutions", {
      examId, rollKey: key, keepScanId, supersededScanIds: group.filter((s) => s._id !== keepScanId).map((s) => s._id), teacherId: user._id, timestamp: Date.now(),
    });
    await bumpRevision(ctx, exam);
    return id;
  },
});

export const listResolutions = query({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    await requireExam(ctx, examId, "viewer");
    return ctx.db.query("conflictResolutions").withIndex("by_exam", (q) => q.eq("examId", examId)).collect();
  },
});

// ------------------------------------------------------------------ analytics
/**
 * Live item analysis (p, D, r_pbis, distractors) and KR-20. Served from the snapshot that the
 * background job keeps up to date; `stale` is true while a newer revision is being computed.
 */
export const getExamAnalytics = query({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    const { exam } = await requireExam(ctx, examId, "viewer");
    const snap = await ctx.db.query("examAnalytics").withIndex("by_exam", (q) => q.eq("examId", examId)).unique();
    if (!snap) return { status: "pending" as const, revision: exam.revision };
    return { status: snap.revision >= exam.revision ? ("current" as const) : ("stale" as const), revision: exam.revision, snapshot: snap };
  },
});
