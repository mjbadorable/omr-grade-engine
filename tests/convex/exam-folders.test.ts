// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { createOrg } from "../helpers/org";
import { buildSampleExam } from "@/lib/samples/sample-kit";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "owner", name: "Owner", email: "owner@usa.edu.ph", emailVerified: true });
  const teacher = t.withIdentity({ subject: "t1", name: "Teacher One", email: "t1@usa.edu.ph", emailVerified: true });
  const otherTeacher = t.withIdentity({ subject: "t2", name: "Teacher Two", email: "t2@usa.edu.ph", emailVerified: true });
  const viewer = t.withIdentity({ subject: "v1", name: "Viewer", email: "v1@usa.edu.ph", emailVerified: true });
  for (const u of [owner, teacher, otherTeacher, viewer]) await u.mutation(api.users.store, {});
  const orgId = await createOrg(t, owner, "University of San Agustin");
  await owner.mutation(api.orgs.addMember, { orgId, email: "t1@usa.edu.ph", role: "teacher" });
  await owner.mutation(api.orgs.addMember, { orgId, email: "t2@usa.edu.ph", role: "teacher" });
  await owner.mutation(api.orgs.addMember, { orgId, email: "v1@usa.edu.ph", role: "viewer" });
  const examId = await teacher.mutation(api.exams.create, { orgId, name: "Midterm Exam", template: kit.template });
  return { t, owner, teacher, otherTeacher, viewer, orgId, examId };
}

describe("exam folders, duplicate, archive, and delete", () => {
  it("creates, renames, assigns, and removes semester folders with RBAC", async () => {
    const { teacher, viewer, orgId, examId } = await setup();
    await expect(viewer.mutation(api.examFolders.create, { orgId, name: "1st Sem", semester: "1st Semester" })).rejects.toThrow(/role|teacher/i);

    const folderId = await teacher.mutation(api.examFolders.create, {
      orgId, name: "1st Sem 2026-2027", semester: "1st Semester", schoolYear: "2026-2027",
    });
    await teacher.mutation(api.exams.setFolder, { examId, folderId });

    const exams = await viewer.query(api.exams.listByOrg, { orgId });
    expect(exams[0].folderId).toBe(folderId);

    await teacher.mutation(api.examFolders.rename, { folderId, name: "1st Sem SY 2026-2027" });
    const folders = await viewer.query(api.examFolders.listByOrg, { orgId });
    expect(folders[0].name).toBe("1st Sem SY 2026-2027");

    await teacher.mutation(api.examFolders.remove, { folderId });
    expect(await viewer.query(api.examFolders.listByOrg, { orgId })).toEqual([]);
    expect((await viewer.query(api.exams.listByOrg, { orgId }))[0].folderId).toBeNull();
  });

  it("duplicates a set-up exam (template + answer key + folder) without copying scans", async () => {
    const { teacher, orgId, examId } = await setup();
    const folderId = await teacher.mutation(api.examFolders.create, { orgId, name: "2nd Sem", semester: "2nd Semester" });
    await teacher.mutation(api.exams.setFolder, { examId, folderId });

    const copyId = await teacher.mutation(api.exams.duplicate, { examId });
    expect(copyId).not.toBe(examId);

    const exams = await teacher.query(api.exams.listByOrg, { orgId });
    const copy = exams.find((e) => e._id === copyId)!;
    expect(copy.name).toBe("Midterm Exam (Copy)");
    expect(copy.folderId).toBe(folderId);
    expect(copy.layoutHash).toBe(kit.template.layoutHash);
    expect(copy.archivedAt).toBeNull();

    const copyKey = await teacher.query(api.grading.getAnswerKey, { examId: copyId });
    expect(copyKey).not.toBeNull();
    const copyScans = await teacher.query(api.grading.listScans, { examId: copyId, paginationOpts: { numItems: 10, cursor: null } });
    expect(copyScans.page).toEqual([]);
  });

  it("archives and restores an exam, and enforces creator/admin delete RBAC", async () => {
    const { owner, teacher, otherTeacher, viewer, orgId, examId } = await setup();
    await expect(viewer.mutation(api.exams.archive, { examId, archived: true })).rejects.toThrow(/role|teacher/i);

    await teacher.mutation(api.exams.archive, { examId, archived: true });
    let list = await teacher.query(api.exams.listByOrg, { orgId });
    expect(list[0].archivedAt).not.toBeNull();

    await teacher.mutation(api.exams.archive, { examId, archived: false });
    list = await teacher.query(api.exams.listByOrg, { orgId });
    expect(list[0].archivedAt).toBeNull();

    // another teacher cannot delete an exam they did not create, but the creator or owner/admin can
    await expect(otherTeacher.mutation(api.exams.remove, { examId })).rejects.toThrow(/creator|admin|role/i);
    await owner.mutation(api.exams.remove, { examId });
    expect(await teacher.query(api.exams.listByOrg, { orgId })).toEqual([]);
  });
});
