// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Persistent per-user rate limits on the mutations that write data or cost money (uploads, scans, exams). */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { LIMITS, rateLimit } from "../../convex/lib/rateLimit";
import { createOrg } from "../helpers/org";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import { parseSyllabusText } from "@/lib/syllabus/parse-syllabus";
import type { DecodedFields } from "@/lib/vision/types";
import { IT321_TEXT } from "../syllabus/fixtures/it321";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const { syllabus } = parseSyllabusText(IT321_TEXT);
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };
const readouts = { states: "E", density: [0], confidence: [0.9] };
const fields = (roll: string): DecodedFields => ({ rollNumber: roll, rollDigits: [...roll], examSet: "A", numeric: [], matrix: [], conflicts: [], answers: [{ questionNumber: 1, marked: [0], labels: ["A"], uncertain: false }] });
const scan = (id: string) => ({ clientScanId: id, layoutHash: kit.template.layoutHash, pageIndex: 0, fields: fields(id), rawBubbleReadouts: readouts, confidence: 0.9, scanTimestamp: 1000 });

const SAVED = JSON.parse(JSON.stringify(LIMITS)) as typeof LIMITS;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); Object.assign(LIMITS, SAVED); });

describe("rateLimit (unit)", () => {
  const rule = { max: 2, windowMs: 60_000 };
  const hit = (t: ReturnType<typeof convexTest>, key: string, bucket = "users.store") => t.run((ctx) => rateLimit(ctx, key, bucket as never, rule));

  it("allows up to max calls in the window, then refuses with RATE_LIMITED", async () => {
    const t = convexTest(schema, modules);
    await hit(t, "u1"); await hit(t, "u1");
    expect(await code(hit(t, "u1"))).toBe("RATE_LIMITED");
  });

  it("counts each person and each bucket separately", async () => {
    const t = convexTest(schema, modules);
    await hit(t, "u1"); await hit(t, "u1");
    expect(await code(hit(t, "u2"))).toBe("OK");
    expect(await code(hit(t, "u1", "exams.create"))).toBe("OK");
  });

  it("frees up as the window slides", async () => {
    const t = convexTest(schema, modules);
    await hit(t, "u1"); await hit(t, "u1");
    expect(await code(hit(t, "u1"))).toBe("RATE_LIMITED");
    vi.advanceTimersByTime(60_001);
    expect(await code(hit(t, "u1"))).toBe("OK");
  });

  it("does not record refused attempts, and removes expired events", async () => {
    const t = convexTest(schema, modules);
    await hit(t, "u1"); await hit(t, "u1");
    await code(hit(t, "u1")); await code(hit(t, "u1"));
    expect(await t.run(async (ctx) => (await ctx.db.query("rateEvents").collect()).length)).toBe(2);
    vi.advanceTimersByTime(120_000);
    await hit(t, "u1");
    expect(await t.run(async (ctx) => (await ctx.db.query("rateEvents").collect()).length)).toBe(1);
  });
});

describe("limits are generous enough for real classroom use", () => {
  it("covers all nine protected actions", () => {
    expect(Object.keys(LIMITS).sort()).toEqual(["examFolders.create", "exams.create", "grading.addOverrides", "grading.generateUploadUrl", "grading.submitScanBatch", "orgs.ensureDefault", "orgs.requestAccess", "syllabi.upsert", "users.store"]);
  });
  it("lets a teacher scan and upload a few hundred sheets (even a whole offline queue replaying) in ten minutes", () => {
    for (const b of ["grading.submitScanBatch", "grading.generateUploadUrl"] as const) {
      expect(LIMITS[b].max).toBeGreaterThanOrEqual(500);
      expect(LIMITS[b].windowMs).toBeLessThanOrEqual(10 * 60_000);
    }
  });
  it("is still a real cap everywhere", () => {
    for (const r of Object.values(LIMITS)) { expect(r.max).toBeGreaterThan(0); expect(r.max).toBeLessThanOrEqual(1000); expect(r.windowMs).toBeGreaterThan(0); }
  });
});

describe("protected endpoints refuse the call past the limit", () => {
  async function world() {
    const t = convexTest(schema, modules);
    const as = (id: string) => t.withIdentity({ subject: id, name: id, email: `${id}@usa.edu.ph`, emailVerified: true });
    const owner = as("owner"), teacher = as("t1"), student = as("stu");
    for (const u of [owner, teacher, student]) await u.mutation(api.users.store, {});
    const orgId = await createOrg(t, owner, "USA");
    await owner.mutation(api.orgs.addMember, { orgId, email: "t1@usa.edu.ph", role: "teacher" });
    const examId = await teacher.mutation(api.exams.create, { orgId, name: "Quiz", template: kit.template });
    const [first] = await teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan("seed")] });
    await t.run(async (ctx) => { for (const r of await ctx.db.query("rateEvents").collect()) await ctx.db.delete(r._id); });   // start every test with a clean slate
    return { t, teacher, student, orgId, examId, scanId: (first as { scanId: Id<"scans"> }).scanId };
  }
  const tight = (bucket: keyof typeof LIMITS) => { LIMITS[bucket] = { max: 2, windowMs: 60_000 }; };
  const thirdIsLimited = async (call: (i: number) => Promise<unknown>) => {
    expect(await code(call(1))).toBe("OK");
    expect(await code(call(2))).toBe("OK");
    expect(await code(call(3))).toBe("RATE_LIMITED");
  };

  it("users.store", async () => { const { student } = await world(); tight("users.store"); await thirdIsLimited(() => student.mutation(api.users.store, {})); });
  it("orgs.ensureDefault", async () => { const { student } = await world(); tight("orgs.ensureDefault"); await thirdIsLimited(() => student.mutation(api.orgs.ensureDefault, {})); });
  it("orgs.requestAccess", async () => { const { student } = await world(); await student.mutation(api.orgs.ensureDefault, {}); tight("orgs.requestAccess"); await thirdIsLimited(() => student.mutation(api.orgs.requestAccess, {})); });
  it("exams.create", async () => { const { teacher, orgId } = await world(); tight("exams.create"); await thirdIsLimited((i) => teacher.mutation(api.exams.create, { orgId, name: `E${i}`, template: kit.template })); });
  it("syllabi.upsert", async () => { const { teacher, orgId } = await world(); tight("syllabi.upsert"); await thirdIsLimited(() => teacher.mutation(api.syllabi.upsert, { orgId, syllabus })); });
  it("grading.submitScanBatch", async () => { const { teacher, examId } = await world(); tight("grading.submitScanBatch"); await thirdIsLimited((i) => teacher.mutation(api.grading.submitScanBatch, { examId, deviceId: "d", scans: [scan(`s${i}`)] })); });
  it("grading.generateUploadUrl", async () => { const { teacher, examId } = await world(); tight("grading.generateUploadUrl"); await thirdIsLimited(() => teacher.mutation(api.grading.generateUploadUrl, { examId })); });
  it("grading.addOverrides", async () => {
    const { teacher, examId, scanId } = await world(); tight("grading.addOverrides");
    await thirdIsLimited((i) => teacher.mutation(api.grading.addOverrides, { examId, patches: [{ patchId: `p${i}`, scanId, target: "answer", questionNumber: 1, originalState: { marked: [0] }, overriddenOption: [1], reason: "checked", timestamp: i }] }));
  });

  it("a refused call changes nothing (no exam is created past the limit)", async () => {
    const { t, teacher, orgId } = await world(); tight("exams.create");
    for (let i = 0; i < 3; i++) await code(teacher.mutation(api.exams.create, { orgId, name: `E${i}`, template: kit.template }));
    expect(await t.run(async (ctx) => (await ctx.db.query("exams").collect()).length)).toBe(1 + 2);       // the seed exam + the two allowed ones
  });

  it("one person's limit never blocks someone else", async () => {
    const { teacher, student } = await world(); tight("users.store");
    await code(student.mutation(api.users.store, {})); await code(student.mutation(api.users.store, {}));
    expect(await code(student.mutation(api.users.store, {}))).toBe("RATE_LIMITED");
    expect(await code(teacher.mutation(api.users.store, {}))).toBe("OK");
  });
});
