// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Courses and sections: owner-scoped, validated, bounded, rate limited; exams can be filed under them. */
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
const SAVED = JSON.parse(JSON.stringify(LIMITS)) as typeof LIMITS;
afterEach(() => { Object.assign(LIMITS, SAVED); });
const base = { code: "HM 5", title: "Applied Business Tools", semester: "1st Semester", schoolYear: "2026-2027", sections: ["BS-HM 2A", "BS-HM 2B", "BS-HM 2C"] };
const students = [{ rollNumber: "240101", name: "Tala Garcia" }];

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
const sectionsOf = async (u: Awaited<ReturnType<typeof world>>["teacher"], orgId: never, courseId: string) => (await u.query(api.courses.listMine, { orgId })).find((c) => c._id === courseId)!.sections;

describe("courses: create, list, update, remove", () => {
  it("creates a course with three lightweight sections and lists it", async () => {
    const { teacher, orgId } = await world();
    const id = await teacher.mutation(api.courses.create, { orgId, ...base });
    const [c] = await teacher.query(api.courses.listMine, { orgId });
    expect(c).toMatchObject({ _id: id, code: "HM 5", title: "Applied Business Tools", semester: "1st Semester", schoolYear: "2026-2027", syllabusId: null });
    expect(c.sections.map((s) => s.name)).toEqual(["BS-HM 2A", "BS-HM 2B", "BS-HM 2C"]);
    expect(c.sections.every((s) => s.id.length > 0 && s.classId === null)).toBe(true);
    expect(new Set(c.sections.map((s) => s.id)).size).toBe(3);
  });
  it("trims the fields and refuses a duplicate course in the same term", async () => {
    const { teacher, orgId } = await world();
    await teacher.mutation(api.courses.create, { orgId, ...base, code: " HM 5 ", sections: [] });
    expect((await teacher.query(api.courses.listMine, { orgId }))[0].code).toBe("HM 5");
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, code: "hm 5", sections: [] }))).toBe("DUPLICATE");
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, semester: "2nd Semester", sections: [] }))).toBe("OK");
  });
  it("updates the fields and links a syllabus of this school only", async () => {
    const { t, teacher, outsider, orgId, otherOrg } = await world();
    const id = await teacher.mutation(api.courses.create, { orgId, ...base });
    await teacher.mutation(api.courses.update, { courseId: id, code: "HM 5A", title: "New", semester: "2nd Semester" });
    expect((await teacher.query(api.courses.listMine, { orgId }))[0]).toMatchObject({ code: "HM 5A", title: "New", semester: "2nd Semester", schoolYear: null });
    const me = (await teacher.query(api.users.me, {}))!;
    const foreign = await t.run((ctx) => ctx.db.insert("syllabi", { orgId: otherOrg, courseCode: "X", courseTitle: "X", term: "", programOutcomes: [], courseOutcomes: [], modules: [], gradingPolicy: { lectureWeight: 0, labWeight: 0, components: [], source: "default" }, uploadedBy: me._id, createdAt: 1 }));
    expect(await code(teacher.mutation(api.courses.update, { courseId: id, code: "HM 5A", title: "New", semester: "S", syllabusId: foreign }))).toBe("NOT_FOUND");
    void outsider;
  });
  it("removing a course unassigns its exams but keeps them", async () => {
    const { teacher, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    const [sec] = await sectionsOf(teacher, orgId as never, cid);
    const e1 = await teacher.mutation(api.exams.create, { orgId, name: "All", template: kit.template, courseId: cid });
    const e2 = await teacher.mutation(api.exams.create, { orgId, name: "One", template: { ...kit.template, layoutHash: "abcdef0123456789" }, courseId: cid, sectionId: sec.id });
    await teacher.mutation(api.courses.remove, { courseId: cid });
    expect(await teacher.query(api.courses.listMine, { orgId })).toEqual([]);
    const exams = await teacher.query(api.exams.listByOrg, { orgId });
    expect(exams.map((e) => e._id).sort()).toEqual([e1, e2].sort());
    expect(exams.every((e) => e.courseId === null && e.sectionId === null)).toBe(true);
  });
});

describe("courses: sections", () => {
  it("adds and removes a section; refuses duplicates, the 21st, and a section that exams use", async () => {
    const { teacher, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    await teacher.mutation(api.courses.addSection, { courseId: cid, name: "BS-HM 2D" });
    expect((await sectionsOf(teacher, orgId as never, cid)).map((s) => s.name)).toEqual(["BS-HM 2A", "BS-HM 2B", "BS-HM 2C", "BS-HM 2D"]);
    expect(await code(teacher.mutation(api.courses.addSection, { courseId: cid, name: "bs-hm 2a" }))).toBe("INVALID_COURSE");
    const [a, , , d] = await sectionsOf(teacher, orgId as never, cid);
    await teacher.mutation(api.exams.create, { orgId, name: "Q", template: kit.template, courseId: cid, sectionId: a.id });
    expect(await code(teacher.mutation(api.courses.removeSection, { courseId: cid, sectionId: a.id }))).toBe("IN_USE");
    await teacher.mutation(api.courses.removeSection, { courseId: cid, sectionId: d.id });
    expect(await sectionsOf(teacher, orgId as never, cid)).toHaveLength(3);
    for (let i = 0; i < 17; i++) await teacher.mutation(api.courses.addSection, { courseId: cid, name: `S${i}` });
    expect(await code(teacher.mutation(api.courses.addSection, { courseId: cid, name: "one too many" }))).toBe("INVALID_COURSE");
  });
  it("refuses more than 20 sections at creation and over-long text", async () => {
    const { teacher, orgId } = await world();
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, sections: Array.from({ length: 21 }, (_, i) => `S${i}`) }))).toBe("TOO_MANY");
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, code: "c".repeat(41) }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, title: "t".repeat(201) }))).toBe("TOO_LONG");
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, sections: ["x".repeat(61)] }))).toBe("TOO_LONG");
  });
  it("links a section to the caller's own class (no roster copied) and unlinks it", async () => {
    const { teacher, other, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    const [a] = await sectionsOf(teacher, orgId as never, cid);
    const mine = await teacher.mutation(api.classes.save, { orgId, name: "HM 2A", students });
    const theirs = await other.mutation(api.classes.save, { orgId, name: "Theirs", students });
    await teacher.mutation(api.courses.setSectionClass, { courseId: cid, sectionId: a.id, classId: mine });
    expect((await sectionsOf(teacher, orgId as never, cid))[0].classId).toBe(mine);
    expect(await code(teacher.mutation(api.courses.setSectionClass, { courseId: cid, sectionId: a.id, classId: theirs }))).toBe("NOT_FOUND");
    await teacher.mutation(api.courses.setSectionClass, { courseId: cid, sectionId: a.id, classId: null });
    expect((await sectionsOf(teacher, orgId as never, cid))[0].classId).toBeNull();
  });
});

describe("courses: access control", () => {
  it("signed-out callers are refused", async () => {
    const { t, orgId } = await world();
    expect(await code(t.mutation(api.courses.create, { orgId, ...base }))).toBe("UNAUTHENTICATED");
    expect(await code(t.query(api.courses.listMine, { orgId }))).toBe("UNAUTHENTICATED");
  });
  it("a viewer cannot create (and lists nothing); someone from another school is refused", async () => {
    const { viewer, outsider, orgId } = await world();
    expect(await code(viewer.mutation(api.courses.create, { orgId, ...base }))).toBe("FORBIDDEN");
    expect(await viewer.query(api.courses.listMine, { orgId })).toEqual([]);
    expect(await code(outsider.mutation(api.courses.create, { orgId, ...base }))).toBe("FORBIDDEN");
    expect(await code(outsider.query(api.courses.listMine, { orgId }))).toBe("FORBIDDEN");
  });
  it("another teacher never sees, changes or removes my course", async () => {
    const { teacher, other, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    const [a] = await sectionsOf(teacher, orgId as never, cid);
    expect(await other.query(api.courses.listMine, { orgId })).toEqual([]);
    expect(await code(other.mutation(api.courses.update, { courseId: cid, code: "X", title: "Y", semester: "Z" }))).toBe("NOT_FOUND");
    expect(await code(other.mutation(api.courses.addSection, { courseId: cid, name: "X" }))).toBe("NOT_FOUND");
    expect(await code(other.mutation(api.courses.removeSection, { courseId: cid, sectionId: a.id }))).toBe("NOT_FOUND");
    expect(await code(other.mutation(api.courses.setSectionClass, { courseId: cid, sectionId: a.id, classId: null }))).toBe("NOT_FOUND");
    expect(await code(other.mutation(api.courses.remove, { courseId: cid }))).toBe("NOT_FOUND");
    expect(await teacher.query(api.courses.listMine, { orgId })).toHaveLength(1);
  });
  it("is rate limited per person, and a refused create writes nothing", async () => {
    const { t, teacher, other, orgId } = await world();
    LIMITS["courses.create"] = { max: 2, windowMs: 60_000 };
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, code: "A", sections: [] }))).toBe("OK");
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, code: "B", sections: [] }))).toBe("OK");
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base, code: "C", sections: [] }))).toBe("RATE_LIMITED");
    expect(await code(other.mutation(api.courses.create, { orgId, ...base, code: "A", sections: [] }))).toBe("OK");
    expect(await t.run(async (ctx) => (await ctx.db.query("courses").collect()).length)).toBe(3);
  });
  it("stops one person keeping more than 100 courses", async () => {
    const { t, teacher, orgId } = await world();
    const me = (await teacher.query(api.users.me, {}))!;
    await t.run(async (ctx) => { for (let i = 0; i < 100; i++) await ctx.db.insert("courses", { orgId, code: `C${i}`, title: "t", semester: "s", sections: [], createdBy: me._id, createdAt: 1, updatedAt: 1 }); });
    expect(await code(teacher.mutation(api.courses.create, { orgId, ...base }))).toBe("TOO_MANY");
  });
});

describe("exams filed under a course", () => {
  it("defaults to All sections (no section) and can target a single section", async () => {
    const { teacher, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    const [a] = await sectionsOf(teacher, orgId as never, cid);
    const all = await teacher.mutation(api.exams.create, { orgId, name: "Prelim", template: kit.template, courseId: cid, sectionId: null });
    const one = await teacher.mutation(api.exams.create, { orgId, name: "Quiz 2A", template: { ...kit.template, layoutHash: "abcdef0123456789" }, courseId: cid, sectionId: a.id });
    const loose = await teacher.mutation(api.exams.create, { orgId, name: "Loose", template: { ...kit.template, layoutHash: "0123456789abcdef" } });
    const list = await teacher.query(api.exams.listByOrg, { orgId });
    const by = (id: string) => list.find((e) => e._id === id)!;
    expect([by(all).courseId, by(all).sectionId]).toEqual([cid, null]);
    expect([by(one).courseId, by(one).sectionId]).toEqual([cid, a.id]);
    expect([by(loose).courseId, by(loose).sectionId]).toEqual([null, null]);
  });
  it("refuses an unknown section, a section without a course, and a course that is not yours", async () => {
    const { teacher, other, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    expect(await code(teacher.mutation(api.exams.create, { orgId, name: "X", template: kit.template, courseId: cid, sectionId: "nope" }))).toBe("NOT_FOUND");
    expect(await code(teacher.mutation(api.exams.create, { orgId, name: "X", template: kit.template, sectionId: "s1" }))).toBe("INVALID_COURSE");
    expect(await code(other.mutation(api.exams.create, { orgId, name: "X", template: kit.template, courseId: cid }))).toBe("NOT_FOUND");
  });
  it("refuses a course from another school", async () => {
    const { t, teacher, orgId, otherOrg } = await world();
    const me = (await teacher.query(api.users.me, {}))!;
    const foreign = await t.run((ctx) => ctx.db.insert("courses", { orgId: otherOrg, code: "F", title: "t", semester: "s", sections: [], createdBy: me._id, createdAt: 1, updatedAt: 1 }));
    expect(await code(teacher.mutation(api.exams.create, { orgId, name: "X", template: kit.template, courseId: foreign }))).toBe("NOT_FOUND");
  });
  it("a copy stays in the same course and section", async () => {
    const { teacher, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    const [a] = await sectionsOf(teacher, orgId as never, cid);
    const e = await teacher.mutation(api.exams.create, { orgId, name: "Q", template: kit.template, courseId: cid, sectionId: a.id });
    const copy = await teacher.mutation(api.exams.duplicate, { examId: e });
    const c = (await teacher.query(api.exams.listByOrg, { orgId })).find((x) => x._id === copy)!;
    expect([c.courseId, c.sectionId]).toEqual([cid, a.id]);
  });
  it("bulk applies a template or existing exam to selected sections with strict validation and scoping", async () => {
    const { teacher, other, viewer, orgId } = await world();
    const cid = await teacher.mutation(api.courses.create, { orgId, ...base });
    const secs = await sectionsOf(teacher, orgId as never, cid);

    const templateRes = await teacher.mutation(api.exams.applyToSections, {
      orgId,
      courseId: cid,
      sectionIds: [secs[0].id, secs[2].id],
      baseName: "Prelim Exam",
      templateJson: JSON.stringify(kit.template),
    });
    expect(templateRes.count).toBe(2);

    const list = await teacher.query(api.exams.listByOrg, { orgId });
    expect(list.filter((e) => e.courseId === cid).map((e) => e.name).sort()).toEqual(["Prelim Exam · 2A", "Prelim Exam · 2C"]);

    // Clones an existing exam (including its updated answer key) across all 3 sections
    const srcId = templateRes.examIds[0];
    const curKey = (await teacher.query(api.grading.getAnswerKey, { examId: srcId }))!;
    const { _id, _creationTime, examId: _e, version: _v, createdBy, clientKeyId, ...keyBody } = curKey;
    void _id; void _creationTime; void _e; void _v; void createdBy; void clientKeyId;
    const q1 = keyBody.questions["1"];
    if (q1.type !== "choice") throw new Error("Expected choice question");
    await teacher.mutation(api.grading.updateAnswerKey, {
      examId: srcId,
      baseVersion: 1,
      key: {
        ...keyBody,
        questions: {
          ...keyBody.questions,
          "1": { ...q1, correct: [1] },
        },
      },
    });
    const cloneRes = await teacher.mutation(api.exams.applyToSections, {
      orgId,
      courseId: cid,
      sectionIds: secs.map((s) => s.id),
      baseName: "Midterm",
      sourceExamId: srcId,
    });
    expect(cloneRes.count).toBe(3);
    const clonedKey = await teacher.query(api.grading.getAnswerKey, { examId: cloneRes.examIds[1] });
    const clonedQ1 = clonedKey?.questions["1"];
    expect(clonedQ1?.type === "choice" ? clonedQ1.correct : null).toEqual([1]);

    // Rejects viewer, non-owner, bad section, empty selection, and invalid JSON template
    expect(await code(viewer.mutation(api.exams.applyToSections, { orgId, courseId: cid, sectionIds: [secs[0].id], templateJson: JSON.stringify(kit.template) }))).toBe("FORBIDDEN");
    expect(await code(other.mutation(api.exams.applyToSections, { orgId, courseId: cid, sectionIds: [secs[0].id], templateJson: JSON.stringify(kit.template) }))).toBe("NOT_FOUND");
    expect(await code(teacher.mutation(api.exams.applyToSections, { orgId, courseId: cid, sectionIds: ["missing-sec"], templateJson: JSON.stringify(kit.template) }))).toBe("INVALID_SECTION");
    expect(await code(teacher.mutation(api.exams.applyToSections, { orgId, courseId: cid, sectionIds: [], templateJson: JSON.stringify(kit.template) }))).toBe("INVALID_SECTION");
    expect(await code(teacher.mutation(api.exams.applyToSections, { orgId, courseId: cid, sectionIds: [secs[0].id], templateJson: "{bad" }))).toBe("INVALID_TEMPLATE");
  });
});
