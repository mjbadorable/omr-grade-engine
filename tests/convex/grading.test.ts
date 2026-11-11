// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Convex backend behaviour (convex-test runs the real functions against an in-memory database
 * with simulated identities and a controllable scheduler).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { answerKeyToBody, bodyToAnswerKey, type AnswerKeyBody } from "@/lib/cloud/convert";
import { analyzeItems } from "@/lib/grading/item-analysis";
import { rescoreBatch } from "@/lib/grading/scorer";
import { simulateClass } from "@/lib/grading/simulate";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import type { DecodedFields } from "@/lib/vision/types";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const readouts = { states: "E", density: [0], confidence: [0.9] };

function fields(roll: string | null, answers: Record<number, number[]>, set = "A"): DecodedFields {
  return {
    rollNumber: roll, rollDigits: roll ? [...roll] : [], examSet: set, numeric: [], matrix: [], conflicts: [],
    answers: Object.entries(answers).map(([q, m]) => ({ questionNumber: +q, marked: m, labels: m.map((i) => "ABCD"[i]), uncertain: false })),
  };
}
const scan = (id: string, f: DecodedFields, extra: Partial<{ layoutHash: string; scanTimestamp: number }> = {}) => ({
  clientScanId: id, layoutHash: kit.template.layoutHash, pageIndex: 0, fields: f, rawBubbleReadouts: readouts, confidence: 0.9, scanTimestamp: 1000, ...extra,
});

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "owner", name: "Owner", email: "owner@usa.edu.ph", emailVerified: true });
  const teacher = t.withIdentity({ subject: "t1", name: "Teacher One", email: "t1@usa.edu.ph", emailVerified: true });
  const viewer = t.withIdentity({ subject: "v1", name: "Viewer", email: "v1@usa.edu.ph", emailVerified: true });
  const stranger = t.withIdentity({ subject: "x", name: "Stranger", email: "x@usa.edu.ph", emailVerified: true });
  for (const u of [owner, teacher, viewer, stranger]) await u.mutation(api.users.store, {});
  const orgId = await owner.mutation(api.orgs.create, { name: "St. Example High" });
  await owner.mutation(api.orgs.addMember, { orgId, email: "T1@usa.edu.ph", role: "teacher" });
  await owner.mutation(api.orgs.addMember, { orgId, email: "v1@usa.edu.ph", role: "viewer" });
  const examId = await teacher.mutation(api.exams.create, { orgId, name: "Quiz 1", template: kit.template });
  return { t, owner, teacher, viewer, stranger, orgId, examId };
}

const errorCode = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); }
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("tenancy and auth", () => {
  it("requires sign-in, membership and role", async () => {
    const { t, teacher, viewer, stranger, orgId, examId } = await setup();
    expect(await errorCode(t.query(api.exams.listByOrg, { orgId }))).toBe("UNAUTHENTICATED");
    expect(await errorCode(stranger.query(api.exams.get, { examId }))).toBe("FORBIDDEN");
    expect(await errorCode(viewer.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("s", fields("1", {}))] }))).toBe("FORBIDDEN");
    expect((await viewer.query(api.exams.listByOrg, { orgId }))[0].name).toBe("Quiz 1");
    expect(await errorCode(teacher.mutation(api.orgs.addMember, { orgId, email: "x@usa.edu.ph", role: "teacher" }))).toBe("FORBIDDEN");
  });

  it("validates templates with the shared Zod schema and seeds a blank key v1", async () => {
    const { teacher, orgId, examId } = await setup();
    expect(await errorCode(teacher.mutation(api.exams.create, { orgId, name: "bad", template: { ...kit.template, layoutHash: "nope" } }))).toBe("INVALID_TEMPLATE");
    const key = (await teacher.query(api.grading.getAnswerKey, { examId }))!;
    expect(key.version).toBe(1);
    expect(Object.keys(key.questions)).toHaveLength(20);
    const { template } = await teacher.query(api.exams.get, { examId });
    expect(template.layoutHash).toBe(kit.template.layoutHash);
  });
});

describe("submitScanBatch", () => {
  it("stores, is idempotent, rejects other templates, and separates identical rescans from conflicts", async () => {
    const { teacher, viewer, examId } = await setup();
    const r1 = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "dev-A", scans: [
      scan("a1", fields("0240101", { 1: [0], 2: [1] })),
      scan("a2", fields("240102", { 1: [2] })),
      scan("bad", fields("240103", {}), { layoutHash: "ffffffffffffffff" }),
    ] });
    expect(r1.map((r) => r.status)).toEqual(["stored", "stored", "rejected"]);
    const again = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "dev-A", scans: [scan("a1", fields("0240101", { 1: [0], 2: [1] }))] });
    expect(again[0].status).toBe("already_stored");
    // a second device scans student 240101 twice: once identically, once with a different answer
    const r2 = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "dev-B", scans: [
      scan("b1", fields("240101", { 1: [0], 2: [1] })),
      scan("b2", fields("240101", { 1: [0], 2: [3] })),
    ] });
    expect(r2.map((r) => r.status)).toEqual(["duplicate_identical", "conflict"]);
    const page = await viewer.query(api.grading.listScans, { examId, paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page).toHaveLength(4);
    expect(page.page[0]).not.toHaveProperty("rawBubbleReadouts");
    expect(page.page[0].rollKey).toBe("240101");
  });
});

describe("updateAnswerKey", () => {
  it("creates immutable versions with optimistic concurrency and validation", async () => {
    const { teacher, viewer, examId } = await setup();
    const v1 = (await viewer.query(api.grading.getAnswerKey, { examId }))!;
    const body = { questions: v1.questions, sets: v1.sets, defaultSet: v1.defaultSet, gradeBands: v1.gradeBands, conflictPolicy: v1.conflictPolicy };
    const keyed = answerKeyToBody(kit.key);
    expect(await teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: keyed })).toEqual({ version: 2 });
    // a second teacher still editing v1 is told to rebase
    const err = await teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: body }).catch((e) => e.data);
    expect(err).toMatchObject({ code: "KEY_VERSION_CONFLICT", currentVersion: 2 });
    // invalid edits are refused
    const broken = structuredClone(keyed);
    (broken.questions["1"] as { correct: number[] }).correct = [7];
    expect(await errorCode(teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 2, key: broken }))).toBe("INVALID_KEY");
    const missing = structuredClone(keyed);
    delete missing.questions["20"];
    expect(await errorCode(teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 2, key: missing }))).toBe("INVALID_KEY");
    // subscribers see v2; v1 is still readable for the audit trail
    expect((await viewer.query(api.grading.getAnswerKey, { examId }))!.version).toBe(2);
    expect((await viewer.query(api.grading.getAnswerKey, { examId, version: 1 }))!.version).toBe(1);
    expect((await viewer.query(api.grading.listKeyVersions, { examId })).map((k) => k.version)).toEqual([2, 1]);
    // round-trip back into the domain model
    const back = bodyToAnswerKey((await viewer.query(api.grading.getAnswerKey, { examId }))! as unknown as AnswerKeyBody, { examId, version: 2 });
    expect([...back.questions.values()].map((r) => (r.type === "choice" ? r.correct : null))).toEqual([...kit.key.questions.values()].map((r) => (r.type === "choice" ? r.correct : null)));
  });
});

describe("overrides and conflicts", () => {
  it("records the caller as the teacher, requires a reason and is idempotent", async () => {
    const { t, teacher, examId } = await setup();
    const [r] = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("a", fields("240101", { 1: [0] }))] });
    const scanId = (r as { scanId: Id<"scans"> }).scanId;
    const patch = { patchId: "p1", scanId, target: "answer" as const, questionNumber: 1, originalState: { marked: [0] }, overriddenOption: [2], reason: "checked paper", timestamp: 5 };
    expect(await errorCode(teacher.mutation(api.grading.addOverrides, { examId, patches: [{ ...patch, reason: "  " }] }))).toBe("REASON_REQUIRED");
    expect(await teacher.mutation(api.grading.addOverrides, { examId, patches: [patch] })).toEqual({ added: 1 });
    expect(await teacher.mutation(api.grading.addOverrides, { examId, patches: [patch] })).toEqual({ added: 0 });
    const rows = await teacher.query(api.grading.listOverrides, { examId });
    const t1 = await t.run(async (ctx) => ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "t1@usa.edu.ph")).unique());
    expect(rows).toHaveLength(1);
    expect(rows[0].teacherId).toBe(t1!._id);
  });

  it("an override can turn a divergent rescan into an identical one", async () => {
    const { teacher, examId } = await setup();
    const [a] = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "A", scans: [scan("a", fields("7", { 1: [0], 2: [] }))] });
    await teacher.mutation(api.grading.addOverrides, { examId, patches: [{ patchId: "p", scanId: (a as { scanId: Id<"scans"> }).scanId, target: "answer", questionNumber: 2, originalState: {}, overriddenOption: [1], reason: "faint mark", timestamp: 1 }] });
    const [b] = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "B", scans: [scan("b", fields("7", { 1: [0], 2: [1] }))] });
    expect(b.status).toBe("duplicate_identical");
  });
});

describe("getExamAnalytics", () => {
  it("serves a snapshot identical to the browser's own computation, and tracks staleness", async () => {
    const { t, teacher, viewer, examId } = await setup();
    await teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: answerKeyToBody(kit.key) });
    const { scans } = simulateClass({ ...kit.key, sets: { A: {}, B: {} } }, { students: 60, seed: 3 });
    for (let i = 0; i < scans.length; i += 25) {
      await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: scans.slice(i, i + 25).map((s, j) => scan(`s${i + j}`, s.fields, { scanTimestamp: 1000 + i + j })) });
    }
    expect((await viewer.query(api.grading.getExamAnalytics, { examId })).status).not.toBe("current");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const live = await viewer.query(api.grading.getExamAnalytics, { examId });
    expect(live.status).toBe("current");
    // same numbers as scoring the same 60 sheets locally
    const local = analyzeItems(rescoreBatch(scans.map((s, i) => ({ sheetId: `x${i}`, fields: s.fields })), kit.key), kit.key);
    const snap = (live as { snapshot: { kr20: number | null; mean: number; gradedCount: number; report: { items: { p: number; d: number }[] } } }).snapshot;
    expect(snap.gradedCount).toBe(60);
    expect(snap.kr20).toBeCloseTo(local.kr20!, 6);
    expect(snap.mean).toBeCloseTo(local.mean, 6);
    expect(snap.report.items.map((i) => i.p)).toEqual(local.items.map((i) => i.p));

    // a key change marks the snapshot stale until the job reruns
    const cur = (await viewer.query(api.grading.getAnswerKey, { examId }))!;
    const changed = structuredClone({ questions: cur.questions, sets: cur.sets, defaultSet: cur.defaultSet, gradeBands: cur.gradeBands, conflictPolicy: cur.conflictPolicy });
    changed.questions["1"] = { ...changed.questions["1"], bonus: true };
    await teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: cur.version, key: changed });
    expect((await viewer.query(api.grading.getExamAnalytics, { examId })).status).toBe("stale");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await viewer.query(api.grading.getExamAnalytics, { examId });
    expect(after).toMatchObject({ status: "current", snapshot: { keyVersion: 3 } });

    // an older job finishing late cannot overwrite a newer snapshot
    await t.mutation(internal.analytics.storeSnapshot, { examId, revision: 1, keyVersion: 1, scanCount: 0, gradedCount: 0, openConflicts: 0, mean: 0, sd: 0, kr20: null, sem: null, report: {} });
    expect((await viewer.query(api.grading.getExamAnalytics, { examId }) as { snapshot: { keyVersion: number } }).snapshot.keyVersion).toBe(3);
  });

  it("counts open conflicts and clears them when a teacher picks the sheet to keep", async () => {
    const { t, teacher, viewer, examId } = await setup();
    await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "A", scans: [scan("a", fields("9", { 1: [0] }))] });
    const [b] = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "B", scans: [scan("b", fields("9", { 1: [1] }))] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await viewer.query(api.grading.getExamAnalytics, { examId })).toMatchObject({ snapshot: { openConflicts: 1, gradedCount: 2 } });
    await teacher.mutation(api.grading.resolveConflict, { examId, rollKey: "9", keepScanId: (b as { scanId: Id<"scans"> }).scanId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await viewer.query(api.grading.getExamAnalytics, { examId })).toMatchObject({ snapshot: { openConflicts: 0, gradedCount: 1 } });
  });
});
