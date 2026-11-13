// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Role hierarchy enforced by the real Convex functions: teacher vs admin vs owner vs outsiders. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { createOrg } from "../helpers/org";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import { parseSyllabusText } from "@/lib/syllabus/parse-syllabus";
import { assignOutcomes, generateTos } from "@/lib/syllabus/tos";
import { IT321_TEXT } from "../syllabus/fixtures/it321";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const { syllabus } = parseSyllabusText(IT321_TEXT);
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };

async function setup() {
  const t = convexTest(schema, modules);
  const as = (id: string, name: string) => t.withIdentity({ subject: id, name, email: `${id}@usa.edu.ph`, emailVerified: true });
  const owner = as("dean", "Dean"), admin = as("staff", "EdTech Staff"), teacher = as("ana", "Ana"), viewer = as("vic", "Vic"), outsider = as("zed", "Zed");
  for (const u of [owner, admin, teacher, viewer, outsider]) await u.mutation(api.users.store, {});
  const orgId = await createOrg(t, owner, "USA CICT");
  await owner.mutation(api.orgs.addMember, { orgId, email: "staff@usa.edu.ph", role: "admin" });
  await owner.mutation(api.orgs.addMember, { orgId, email: "ana@usa.edu.ph", role: "teacher" });
  await owner.mutation(api.orgs.addMember, { orgId, email: "vic@usa.edu.ph", role: "viewer" });
  const faculty = await admin.query(api.admin.listFaculty, { orgId });
  const idOf = (email: string) => faculty.find((f) => f.email === email)!.userId;
  return { t, owner, admin, teacher, viewer, outsider, orgId, idOf };
}

describe("admin portal access", () => {
  it("only admins/owners reach the governance endpoints", async () => {
    const { owner, admin, teacher, viewer, outsider, orgId } = await setup();
    for (const [who, expected] of [[owner, "OK"], [admin, "OK"], [teacher, "FORBIDDEN"], [viewer, "FORBIDDEN"], [outsider, "FORBIDDEN"]] as const) {
      expect(await code(who.query(api.admin.listFaculty, { orgId })), "listFaculty").toBe(expected);
      expect(await code(who.query(api.admin.auditTrail, { orgId })), "auditTrail").toBe(expected);
      expect(await code(who.mutation(api.admin.setPolicy, { orgId, allowedDomains: [], gradingFormula: { lectureWeight: 67, labWeight: 33, lectureMajorExamWeight: 50, labExamWeight: 30 } })), "setPolicy").toBe(expected);
    }
  });

  it("teachers can read the institution's grading formula (default = USA CLASE)", async () => {
    const { teacher, outsider, orgId } = await setup();
    expect(await teacher.query(api.admin.getPolicy, { orgId })).toMatchObject({ isDefault: true, gradingFormula: { lectureWeight: 67, labWeight: 33, lectureMajorExamWeight: 50, labExamWeight: 30 } });
    expect(await code(outsider.query(api.admin.getPolicy, { orgId }))).toBe("FORBIDDEN");
  });
});

describe("faculty directory & role elevation", () => {
  it("lists faculty with roles, owner first", async () => {
    const { admin, orgId } = await setup();
    const rows = await admin.query(api.admin.listFaculty, { orgId });
    expect(rows.map((r) => `${r.email}:${r.role}`)).toEqual(["dean@usa.edu.ph:owner", "staff@usa.edu.ph:admin", "ana@usa.edu.ph:teacher", "vic@usa.edu.ph:viewer"]);
  });

  it("admin elevates teacher → admin and back; the change is audited", async () => {
    const { admin, teacher, orgId, idOf } = await setup();
    expect(await code(teacher.query(api.admin.auditTrail, { orgId }))).toBe("FORBIDDEN");
    await admin.mutation(api.admin.setRole, { orgId, userId: idOf("ana@usa.edu.ph"), role: "admin" });
    expect(await code(teacher.query(api.admin.listFaculty, { orgId }))).toBe("OK");       // ana is now an admin
    await admin.mutation(api.admin.setRole, { orgId, userId: idOf("ana@usa.edu.ph"), role: "teacher" });
    expect(await code(teacher.query(api.admin.listFaculty, { orgId }))).toBe("FORBIDDEN");
    const trail = await admin.query(api.admin.auditTrail, { orgId, kinds: ["ROLE_CHANGE"] });
    expect(trail.rows.map((r) => r.summary)).toEqual(expect.arrayContaining(["ana@usa.edu.ph role teacher → admin", "ana@usa.edu.ph role admin → teacher"]));
    expect(trail.rows[0]).toMatchObject({ actorEmail: "staff@usa.edu.ph", label: "Role change" });
  });

  it("blocks teachers, self-changes, owner changes and outsiders", async () => {
    const { owner, admin, teacher, outsider, orgId, idOf } = await setup();
    expect(await code(teacher.mutation(api.admin.setRole, { orgId, userId: idOf("vic@usa.edu.ph"), role: "admin" }))).toBe("FORBIDDEN");
    expect(await code(outsider.mutation(api.admin.setRole, { orgId, userId: idOf("vic@usa.edu.ph"), role: "admin" }))).toBe("FORBIDDEN");
    expect(await code(admin.mutation(api.admin.setRole, { orgId, userId: idOf("staff@usa.edu.ph"), role: "teacher" }))).toBe("SELF_CHANGE");
    expect(await code(admin.mutation(api.admin.setRole, { orgId, userId: idOf("dean@usa.edu.ph"), role: "teacher" }))).toBe("OWNER_PROTECTED");
    expect(await code(owner.mutation(api.admin.setRole, { orgId, userId: idOf("ana@usa.edu.ph"), role: "owner" }))).toBe("INVALID_ROLE");
    // addMember cannot be used to bypass the same rules
    expect(await code(admin.mutation(api.orgs.addMember, { orgId, email: "dean@usa.edu.ph", role: "teacher" }))).toBe("OWNER_PROTECTED");
    expect(await code(teacher.mutation(api.orgs.addMember, { orgId, email: "vic@usa.edu.ph", role: "admin" }))).toBe("FORBIDDEN");
  });
});

describe("institutional policy", () => {
  const formula = { lectureWeight: 67, labWeight: 33, lectureMajorExamWeight: 50, labExamWeight: 30 };
  it("stores the domain allowlist and grading formula, and validates them", async () => {
    const { admin, teacher, orgId } = await setup();
    expect(await code(admin.mutation(api.admin.setPolicy, { orgId, allowedDomains: [], gradingFormula: { ...formula, labWeight: 40 } }))).toBe("INVALID_FORMULA");
    expect(await code(admin.mutation(api.admin.setPolicy, { orgId, allowedDomains: ["not a domain"], gradingFormula: formula }))).toBe("INVALID_DOMAIN");
    await admin.mutation(api.admin.setPolicy, { orgId, allowedDomains: ["@USA.edu.ph"], gradingFormula: { ...formula, lectureWeight: 60, labWeight: 40 } });
    expect(await teacher.query(api.admin.getPolicy, { orgId })).toMatchObject({ isDefault: false, allowedDomains: ["usa.edu.ph"], gradingFormula: { lectureWeight: 60, labWeight: 40 } });
    expect((await admin.query(api.admin.auditTrail, { orgId, kinds: ["POLICY_CHANGE"] })).total).toBe(1);
  });

  it("the school's domain policy restricts who can be added", async () => {
    const { t, admin, orgId } = await setup();
    await t.withIdentity({ subject: "guest", name: "Guest", email: "guest@usa.edu.ph", emailVerified: true }).mutation(api.users.store, {});
    await admin.mutation(api.admin.setPolicy, { orgId, allowedDomains: ["faculty.usa.edu.ph"], gradingFormula: formula });
    expect(await code(admin.mutation(api.orgs.addMember, { orgId, email: "guest@usa.edu.ph", role: "teacher" }))).toBe("DOMAIN_NOT_ALLOWED");
  });
});

describe("syllabus repository", () => {
  it("teachers drop syllabi (upsert by course + term); viewers cannot; only admins delete", async () => {
    const { admin, teacher, viewer, orgId } = await setup();
    expect(await code(viewer.mutation(api.syllabi.upsert, { orgId, syllabus }))).toBe("FORBIDDEN");
    const id = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus });
    const again = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus: { ...syllabus, courseTitle: "IAS 1 (revised)" } });
    expect(again).toBe(id);
    const list = await admin.query(api.syllabi.listByOrg, { orgId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ courseCode: "IT 321", courseTitle: "IAS 1 (revised)", poCount: 9, coCount: 4, moduleCount: 9, uploadedByEmail: "ana@usa.edu.ph" });
    expect(await viewer.query(api.syllabi.get, { syllabusId: id })).toMatchObject({ courseOutcomes: expect.any(Array) });
    expect(await code(teacher.mutation(api.syllabi.remove, { syllabusId: id }))).toBe("FORBIDDEN");
    await admin.mutation(api.syllabi.remove, { syllabusId: id });
    expect(await admin.query(api.syllabi.listByOrg, { orgId })).toEqual([]);
  });

  it("rejects syllabi whose COs reference unknown POs, and keeps schools isolated", async () => {
    const { teacher, outsider, orgId } = await setup();
    const bad = { ...syllabus, courseOutcomes: [{ code: "CO1", description: "x", programOutcomes: ["Z"] }] };
    expect(await code(teacher.mutation(api.syllabi.upsert, { orgId, syllabus: bad }))).toBe("INVALID_SYLLABUS");
    const id = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus });
    expect(await code(outsider.query(api.syllabi.get, { syllabusId: id }))).toBe("FORBIDDEN");
    expect(await code(outsider.query(api.syllabi.listByOrg, { orgId }))).toBe("FORBIDDEN");
  });
});

describe("syllabus-bound exams and the audit trail", () => {
  it("creates an exam with TOS outcome codes on the key; binding later makes a new audited key version", async () => {
    const { admin, teacher, orgId } = await setup();
    const syllabusId = await teacher.mutation(api.syllabi.upsert, { orgId, syllabus });
    const total = kit.template.questionCount;
    const outcomes = assignOutcomes(generateTos(syllabus, "PRELIM", total), syllabus);
    const examId = await teacher.mutation(api.exams.create, { orgId, name: "IT 321 Prelim", template: kit.template, syllabusId, examPeriod: "PRELIM", questionOutcomes: outcomes });
    const key = await teacher.query(api.grading.getAnswerKey, { examId });
    expect(key?.version).toBe(1);
    expect(key?.questions["1"]).toMatchObject({ outcomeCode: "CO1", moduleNumber: 1 });
    expect(Object.values(key!.questions).every((r) => r.outcomeCode)).toBe(true);
    expect((await teacher.query(api.exams.listByOrg, { orgId }))[0]).toMatchObject({ syllabusId, examPeriod: "PRELIM" });

    // a plain exam gets bound afterwards → key v2
    const plain = await teacher.mutation(api.exams.create, { orgId, name: "Plain quiz", template: kit.template });
    expect((await teacher.query(api.grading.getAnswerKey, { examId: plain }))?.questions["1"].outcomeCode).toBeUndefined();
    await teacher.mutation(api.exams.bindSyllabus, { examId: plain, syllabusId, examPeriod: "MIDTERM", questionOutcomes: assignOutcomes(generateTos(syllabus, "MIDTERM", total), syllabus) });
    const k2 = await teacher.query(api.grading.getAnswerKey, { examId: plain });
    expect(k2?.version).toBe(2);
    expect(k2?.questions["1"].outcomeCode).toBeTruthy();

    // manual key edit + the bind both appear in the admin audit trail with who/what
    const trail = await admin.query(api.admin.auditTrail, { orgId, kinds: ["KEY_UPDATE", "SYLLABUS_UPLOAD"] });
    expect(trail.rows.some((r) => r.kind === "KEY_UPDATE" && r.examName === "Plain quiz" && /Q1 outcome -→CO3/.test(r.summary) && r.actorEmail === "ana@usa.edu.ph")).toBe(true);
    expect(trail.rows.some((r) => r.kind === "SYLLABUS_UPLOAD")).toBe(true);
    expect((await admin.query(api.admin.auditTrail, { orgId, query: "plain outcome" })).total).toBeGreaterThan(0);
  });

  it("refuses a syllabus from another school", async () => {
    const { t, teacher, orgId } = await setup();
    const other = t.withIdentity({ subject: "ola", name: "Ola", email: "ola@usa.edu.ph", emailVerified: true });
    await other.mutation(api.users.store, {});
    const org2 = await createOrg(t, other, "Other");
    const foreign = await other.mutation(api.syllabi.upsert, { orgId: org2, syllabus });
    expect(await code(teacher.mutation(api.exams.create, { orgId, name: "x", template: kit.template, syllabusId: foreign }))).toBe("NOT_FOUND");
  });
});
