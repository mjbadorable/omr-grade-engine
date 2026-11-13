// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Length and count caps on free-text and list arguments that Convex validators cannot bound. */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { atMost, atMostCount, MAX } from "../../convex/lib/limits";
import { createOrg } from "../helpers/org";
import { answerKeyToBody } from "@/lib/cloud/convert";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import type { DecodedFields } from "@/lib/vision/types";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };
const readouts = { states: "E", density: [0], confidence: [0.9] };
const fields = (roll: string): DecodedFields => ({ rollNumber: roll, rollDigits: [...roll], examSet: "A", numeric: [], matrix: [], conflicts: [], answers: [{ questionNumber: 1, marked: [0], labels: ["A"], uncertain: false }] });
const scan = (id: string, over: Record<string, unknown> = {}) => ({ clientScanId: id, layoutHash: kit.template.layoutHash, pageIndex: 0, fields: fields(id), rawBubbleReadouts: readouts, confidence: 0.9, scanTimestamp: 1000, ...over });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function world() {
  const t = convexTest(schema, modules);
  const as = (id: string) => t.withIdentity({ subject: id, name: id, email: `${id}@usa.edu.ph`, emailVerified: true });
  const owner = as("owner"), teacher = as("t1");
  for (const u of [owner, teacher]) await u.mutation(api.users.store, {});
  const orgId = await createOrg(t, owner, "USA");
  await owner.mutation(api.orgs.addMember, { orgId, email: "t1@usa.edu.ph", role: "teacher" });
  const examId = await teacher.mutation(api.exams.create, { orgId, name: "Quiz", template: kit.template });
  const [first] = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("seed")] });
  return { t, owner, teacher, orgId, examId, scanId: (first as { scanId: Id<"scans"> }).scanId };
}

describe("limit helpers", () => {
  it("atMost refuses text longer than the cap with TOO_LONG", async () => {
    expect(await code(Promise.resolve().then(() => atMost("Name", "x".repeat(5), 5)))).toBe("OK");
    expect(await code(Promise.resolve().then(() => atMost("Name", "x".repeat(6), 5)))).toBe("TOO_LONG");
  });
  it("atMostCount refuses lists longer than the cap with TOO_MANY", async () => {
    expect(await code(Promise.resolve().then(() => atMostCount("Items", 3, 3)))).toBe("OK");
    expect(await code(Promise.resolve().then(() => atMostCount("Items", 4, 3)))).toBe("TOO_MANY");
  });
  it("has sensible caps", () => {
    expect(MAX).toMatchObject({ name: 200, reason: 500, id: 100, emails: 20_000, emailCount: 500, domains: 50, patches: 500, outcomes: 2_000 });
  });
});

describe("exam names and outcome lists", () => {
  it("exams.create accepts a 200-character name and refuses 201", async () => {
    const { teacher, orgId } = await world();
    expect(await code(teacher.mutation(api.exams.create, { orgId, name: "n".repeat(200), template: kit.template }))).toBe("OK");
    expect(await code(teacher.mutation(api.exams.create, { orgId, name: "n".repeat(201), template: kit.template }))).toBe("TOO_LONG");
  });
  it("exams.create refuses an absurd template with INVALID_TEMPLATE", async () => {
    const { teacher, orgId } = await world();
    const huge = structuredClone(kit.template) as Record<string, unknown>;
    huge.title = "x".repeat(10_000);
    expect(await code(teacher.mutation(api.exams.create, { orgId, name: "x", template: huge }))).toBe("INVALID_TEMPLATE");
  });
  it("exams.setRoster refuses an oversized class list with INVALID_ROSTER", async () => {
    const { teacher, examId } = await world();
    const students = Array.from({ length: 5_001 }, (_, i) => ({ rollNumber: String(i), name: `S${i}` }));
    expect(await code(teacher.mutation(api.exams.setRoster, { examId, roster: { schema: "omr-roster/v1", name: "Big", importedAt: 1, students } }))).toBe("INVALID_ROSTER");
  });
});

describe("scan and correction fields", () => {
  it("submitScanBatch caps deviceId, clientScanId and layoutHash", async () => {
    const { teacher, examId } = await world();
    expect(await code(teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d".repeat(101), scans: [scan("a")] }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("c".repeat(101))] }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("a", { layoutHash: "h".repeat(65) })] }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d".repeat(100), scans: [scan("c".repeat(100))] }))).toBe("OK");
  });

  it("addOverrides caps the reason, the patch id and the number of patches", async () => {
    const { teacher, examId, scanId } = await world();
    const p = (i: number, over: Record<string, unknown> = {}) => ({ patchId: `p${i}`, scanId, target: "answer" as const, questionNumber: 1, originalState: { marked: [0] }, overriddenOption: [1], reason: "checked", timestamp: i, ...over });
    expect(await code(teacher.mutation(api.grading.addOverrides, { examId, patches: [p(1, { reason: "r".repeat(501) })] }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.grading.addOverrides, { examId, patches: [p(2, { patchId: "x".repeat(101) })] }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.grading.addOverrides, { examId, patches: Array.from({ length: 501 }, (_, i) => p(i + 10)) }))).toBe("TOO_MANY");
    expect(await code(teacher.mutation(api.grading.addOverrides, { examId, patches: [p(3, { reason: "r".repeat(500) })] }))).toBe("OK");
  });

  it("resolveConflict caps the roll key and client id; updateAnswerKey caps the client key id", async () => {
    const { teacher, examId, scanId } = await world();
    expect(await code(teacher.mutation(api.grading.resolveConflict, { examId, rollKey: "k".repeat(101), keepScanId: scanId }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.grading.resolveConflict, { examId, rollKey: "1", keepScanId: scanId, clientId: "c".repeat(101) }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: answerKeyToBody(kit.key), clientKeyId: "k".repeat(101) }))).toBe("TOO_LONG");
  });
});

describe("admin inputs", () => {
  it("preAuthorize caps the pasted text and the number of addresses", async () => {
    const { owner, orgId } = await world();
    expect(await code(owner.mutation(api.admin.preAuthorize, { orgId, emails: "a@usa.edu.ph ".repeat(2_000), role: "teacher" }))).toBe("TOO_LONG");
    const many = Array.from({ length: 501 }, (_, i) => `t${i}@usa.edu.ph`).join(",");
    expect(await code(owner.mutation(api.admin.preAuthorize, { orgId, emails: many, role: "teacher" }))).toBe("TOO_MANY");
    expect(await code(owner.mutation(api.admin.preAuthorize, { orgId, emails: "ana@usa.edu.ph, ben@usa.edu.ph", role: "teacher" }))).toBe("OK");
  });

  it("setPolicy caps the domain list and each domain", async () => {
    const { owner, orgId } = await world();
    const formula = { lectureWeight: 67, labWeight: 33, lectureMajorExamWeight: 80, labExamWeight: 40 };
    expect(await code(owner.mutation(api.admin.setPolicy, { orgId, gradingFormula: formula, allowedDomains: Array.from({ length: 51 }, (_, i) => `d${i}.edu.ph`) }))).toBe("TOO_MANY");
    expect(await code(owner.mutation(api.admin.setPolicy, { orgId, gradingFormula: formula, allowedDomains: [`${"a".repeat(251)}.ph`] }))).toBe("TOO_LONG");
    expect(await code(owner.mutation(api.admin.setPolicy, { orgId, gradingFormula: formula, allowedDomains: ["usa.edu.ph"] }))).toBe("OK");
  });

  it("addMember caps the email", async () => {
    const { owner, orgId } = await world();
    expect(await code(owner.mutation(api.orgs.addMember, { orgId, email: `${"a".repeat(250)}@x.ph`, role: "teacher" }))).toBe("TOO_LONG");
  });
});
