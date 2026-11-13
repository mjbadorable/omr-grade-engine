// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Server side of the offline outbox: replays must be harmless. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { createOrg } from "../helpers/org";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import type { DecodedFields } from "@/lib/vision/types";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const readouts = { states: "E", density: [0], confidence: [0.9] };
const fields = (roll: string, a0: number): DecodedFields => ({ rollNumber: roll, rollDigits: [...roll], examSet: "A", numeric: [], matrix: [], conflicts: [], answers: [{ questionNumber: 1, marked: [a0], labels: ["ABCD"[a0]], uncertain: false }] });
const scan = (id: string, f: DecodedFields) => ({ clientScanId: id, layoutHash: kit.template.layoutHash, pageIndex: 0, fields: f, rawBubbleReadouts: readouts, confidence: 0.9, scanTimestamp: 1000 });

async function setup() {
  const t = convexTest(schema, modules);
  const teacher = t.withIdentity({ subject: "t1", name: "T1", email: "t1@usa.edu.ph", emailVerified: true });
  await teacher.mutation(api.users.store, {});
  const orgId = await createOrg(t, teacher, "USA");
  const examId = await teacher.mutation(api.exams.create, { orgId, name: "Quiz", template: kit.template });
  return { t, teacher, orgId, examId };
}

describe("updateAnswerKey with clientKeyId", () => {
  it("replaying the same queued save returns the same version instead of conflicting or duplicating", async () => {
    const { teacher, examId } = await setup();
    const k1 = (await teacher.query(api.grading.getAnswerKey, { examId }))!;
    const { _id, _creationTime, createdBy, examId: _e, version, clientKeyId, ...body } = k1; void _id; void _creationTime; void createdBy; void _e; void version; void clientKeyId;
    const a = await teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: body, clientKeyId: "op-1" });
    const b = await teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: body, clientKeyId: "op-1" });   // stale base, same id
    expect(a).toEqual({ version: 2 });
    expect(b).toEqual({ version: 2 });
    expect((await teacher.query(api.grading.listKeyVersions, { examId })).map((v) => v.version)).toEqual([2, 1]);
    // a different save on the stale base still conflicts (optimistic concurrency is intact)
    await expect(teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: body, clientKeyId: "op-2" })).rejects.toMatchObject({ data: { code: "KEY_VERSION_CONFLICT", currentVersion: 2 } });
  });
});

describe("resolveConflict with clientId", () => {
  it("is applied once and keeps the offline timestamp", async () => {
    const { teacher, examId } = await setup();
    await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("a", fields("2301", 0)), scan("b", fields("2301", 1))] });
    const rows = await teacher.query(api.grading.listScans, { examId, paginationOpts: { numItems: 10, cursor: null } });
    const keep = rows.page[0]._id;
    const id1 = await teacher.mutation(api.grading.resolveConflict, { examId, rollKey: "2301", keepScanId: keep, clientId: "res-1", timestamp: 4242 });
    const id2 = await teacher.mutation(api.grading.resolveConflict, { examId, rollKey: "2301", keepScanId: keep, clientId: "res-1", timestamp: 4242 });
    expect(id2).toEqual(id1);
    const list = await teacher.query(api.grading.listResolutions, { examId });
    expect(list).toHaveLength(1);
    expect(list[0].timestamp).toBe(4242);
  });
});

describe("addOverrides replay", () => {
  it("the same patchId is stored once", async () => {
    const { teacher, examId } = await setup();
    await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("a", fields("2301", 0))] });
    const scanId = (await teacher.query(api.grading.listScans, { examId, paginationOpts: { numItems: 10, cursor: null } })).page[0]._id;
    const p = { patchId: "p1", scanId, target: "answer" as const, questionNumber: 1, originalState: { marked: [0] }, overriddenOption: [2], reason: "smudge", timestamp: 5 };
    expect(await teacher.mutation(api.grading.addOverrides, { examId, patches: [p] })).toEqual({ added: 1 });
    expect(await teacher.mutation(api.grading.addOverrides, { examId, patches: [p] })).toEqual({ added: 0 });
    expect(await teacher.query(api.grading.listOverrides, { examId })).toHaveLength(1);
  });
});

describe("scan upload replay", () => {
  it("the same clientScanId is stored once", async () => {
    const { teacher, examId } = await setup();
    const args = { examId, deviceId: "d", scans: [scan("a", fields("2301", 0))] };
    const [r1] = await teacher.mutation(api.grading.submitScanBatch, args);
    const [r2] = await teacher.mutation(api.grading.submitScanBatch, args);
    expect(r1.status).toBe("stored");
    expect(r2.status).toBe("already_stored");
  });
});
