// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Reusable classes: org-scoped, owner-only, validated, bounded and rate limited. */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { LIMITS } from "../../convex/lib/rateLimit";
import { createOrg } from "../helpers/org";
import { buildSampleExam } from "@/lib/samples/sample-kit";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };
const students = [{ rollNumber: "240101", name: "Tala Garcia", section: "10-A" }, { rollNumber: "240102", name: "Noah Kumar" }];
const SAVED = JSON.parse(JSON.stringify(LIMITS)) as typeof LIMITS;
afterEach(() => { Object.assign(LIMITS, SAVED); });

async function world() {
  const t = convexTest(schema, modules);
  const as = (id: string) => t.withIdentity({ subject: id, name: id, email: `${id}@usa.edu.ph`, emailVerified: true });
  const owner = as("owner"), teacher = as("t1"), other = as("t2"), viewer = as("v1"), outsider = as("out");
  for (const u of [owner, teacher, other, viewer, outsider]) await u.mutation(api.users.store, {});
  const orgId = await createOrg(t, owner, "USA");
  for (const [e, role] of [["t1", "teacher"], ["t2", "teacher"], ["v1", "viewer"]] as const) await owner.mutation(api.orgs.addMember, { orgId, email: `${e}@usa.edu.ph`, role });
  const otherOrg = await createOrg(t, outsider, "Elsewhere");
  return { t, owner, teacher, other, viewer, outsider, orgId, otherOrg };
}

describe("classes: save, list, get, remove", () => {
  it("a teacher saves a class once and lists it with a count (not the whole roster)", async () => {
    const { teacher, orgId } = await world();
    const id = await teacher.mutation(api.classes.save, { orgId, name: " CS 101 ", section: "A", students });
    const list = await teacher.query(api.classes.listMine, { orgId });
    expect(list).toEqual([expect.objectContaining({ _id: id, name: "CS 101", section: "A", count: 2 })]);
    expect(JSON.stringify(list)).not.toContain("Tala");
    const got = await teacher.query(api.classes.get, { classId: id });
    expect(got.students).toEqual(students);
  });

  it("saving with the class id updates it; a second class cannot reuse a name and section", async () => {
    const { teacher, orgId } = await world();
    const id = await teacher.mutation(api.classes.save, { orgId, name: "CS 101", students });
    await teacher.mutation(api.classes.save, { orgId, classId: id, name: "CS 101", students: [students[0]] });
    expect((await teacher.query(api.classes.get, { classId: id })).students).toHaveLength(1);
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "cs 101", students }))).toBe("DUPLICATE");
  });

  it("attaching a class uses the existing per-exam roster and keeps it compatible", async () => {
    const { teacher, orgId } = await world();
    const examId = await teacher.mutation(api.exams.create, { orgId, name: "Quiz", template: kit.template });
    const id = await teacher.mutation(api.classes.save, { orgId, name: "CS 101", section: "A", students });
    const c = await teacher.query(api.classes.get, { classId: id });
    await teacher.mutation(api.exams.setRoster, { examId, roster: { schema: "omr-roster/v1", name: "CS 101 · A", importedAt: 1, students: c.students } });
    const r = await teacher.query(api.exams.getRoster, { examId });
    expect(r?.students).toEqual(students);
  });

  it("remove deletes it; the creator may remove, so may a school admin", async () => {
    const { teacher, owner, orgId } = await world();
    const a = await teacher.mutation(api.classes.save, { orgId, name: "A", students });
    const b = await teacher.mutation(api.classes.save, { orgId, name: "B", students });
    await teacher.mutation(api.classes.remove, { classId: a });
    await owner.mutation(api.classes.remove, { classId: b });
    expect(await teacher.query(api.classes.listMine, { orgId })).toEqual([]);
  });
});

describe("classes: access control", () => {
  it("signed-out callers are refused", async () => {
    const { t, orgId } = await world();
    expect(await code(t.mutation(api.classes.save, { orgId, name: "X", students }))).toBe("UNAUTHENTICATED");
    expect(await code(t.query(api.classes.listMine, { orgId }))).toBe("UNAUTHENTICATED");
  });
  it("a viewer, and someone from another school, cannot save or list", async () => {
    const { viewer, outsider, orgId } = await world();
    expect(await code(viewer.mutation(api.classes.save, { orgId, name: "X", students }))).toBe("FORBIDDEN");
    expect(await code(outsider.mutation(api.classes.save, { orgId, name: "X", students }))).toBe("FORBIDDEN");
    expect(await code(outsider.query(api.classes.listMine, { orgId }))).toBe("FORBIDDEN");
  });
  it("another teacher in the same school never sees, reads, changes or removes my class", async () => {
    const { teacher, other, orgId } = await world();
    const id = await teacher.mutation(api.classes.save, { orgId, name: "Mine", students });
    expect(await other.query(api.classes.listMine, { orgId })).toEqual([]);
    expect(await code(other.query(api.classes.get, { classId: id }))).toBe("NOT_FOUND");
    expect(await code(other.mutation(api.classes.save, { orgId, classId: id, name: "Hijack", students }))).toBe("NOT_FOUND");
    expect(await code(other.mutation(api.classes.remove, { classId: id }))).toBe("NOT_FOUND");
    expect((await teacher.query(api.classes.get, { classId: id })).name).toBe("Mine");
  });
  it("a class id cannot be used from another school's org", async () => {
    const { teacher, outsider, orgId, otherOrg } = await world();
    const id = await teacher.mutation(api.classes.save, { orgId, name: "Mine", students });
    expect(await code(outsider.mutation(api.classes.save, { orgId: otherOrg, classId: id, name: "X", students }))).toBe("NOT_FOUND");
    expect(await code(outsider.query(api.classes.get, { classId: id }))).toBe("NOT_FOUND");
  });
});

describe("classes: validation, bounds and rate limit", () => {
  it("refuses a malformed student, a repeated roll number, and an empty class", async () => {
    const { teacher, orgId } = await world();
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "X", students: [{ rollNumber: "", name: "A" }] }))).toBe("INVALID_CLASS");
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "X", students: [{ rollNumber: "007", name: "A" }, { rollNumber: "7", name: "B" }] }))).toBe("INVALID_CLASS");
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "X", students: [] }))).toBe("INVALID_CLASS");
  });
  it("refuses over-long text and too many students", async () => {
    const { teacher, orgId } = await world();
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "x".repeat(201), students }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "X", section: "s".repeat(101), students }))).toBe("TOO_LONG");
    const big = Array.from({ length: 5001 }, (_, i) => ({ rollNumber: String(i + 1), name: "A" }));
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "X", students: big }))).toBe("TOO_MANY");
  });
  it("stops one person keeping more than 100 classes", async () => {
    const { t, teacher, orgId } = await world();
    const me = (await teacher.query(api.users.me, {}))!;
    await t.run(async (ctx) => { for (let i = 0; i < 100; i++) await ctx.db.insert("classes", { orgId, name: `C${i}`, students: [], createdBy: me._id, createdAt: 1, updatedAt: 1 }); });
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "One more", students }))).toBe("TOO_MANY");
  });
  it("is rate limited per person", async () => {
    const { teacher, other, orgId } = await world();
    LIMITS["classes.save"] = { max: 2, windowMs: 60_000 };
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "A", students }))).toBe("OK");
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "B", students }))).toBe("OK");
    expect(await code(teacher.mutation(api.classes.save, { orgId, name: "C", students }))).toBe("RATE_LIMITED");
    expect(await code(other.mutation(api.classes.save, { orgId, name: "A", students }))).toBe("OK");
  });
  it("a refused save writes nothing", async () => {
    const { t, teacher, orgId } = await world();
    await code(teacher.mutation(api.classes.save, { orgId, name: "X", students: [{ rollNumber: "", name: "A" }] }));
    expect(await t.run(async (ctx) => (await ctx.db.query("classes").collect()).length)).toBe(0);
  });
});
