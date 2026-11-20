import { describe, expect, it } from "vitest";
import { courseExamRows } from "@/lib/courses/courses";
import { dashboardRows, type WorkspaceExam } from "@/lib/dashboard";

const cloud = (over: Partial<WorkspaceExam> = {}): WorkspaceExam => ({ _id: "e1", name: "Midterm", layoutHash: "AAA", status: "open", createdAt: 1000, ...over });

describe("dashboard rows carry the course filing", () => {
  it("workspace exams expose courseId and sectionId (null = not in a course / all sections)", () => {
    const rows = dashboardRows({ local: null, localScanCount: null, exams: [cloud({ _id: "a", courseId: "c1", sectionId: "s1", createdAt: 3 }), cloud({ _id: "b", courseId: "c1", layoutHash: "BBB", createdAt: 2 }), cloud({ _id: "c", layoutHash: "CCC", createdAt: 1 })] });
    expect(rows.map((r) => [r.key, r.courseId, r.sectionId])).toEqual([["a", "c1", "s1"], ["b", "c1", null], ["c", null, null]]);
  });
  it("device-only library exams expose it too", () => {
    const rows = dashboardRows({ local: null, localScanCount: null, exams: [], localExams: [{ id: "x", name: "Quiz", layoutHash: "LLL", folderId: null, archivedAt: null, createdAt: 5, courseId: "c9", sectionId: null }, { id: "y", name: "Old", layoutHash: "OOO", folderId: null, archivedAt: null, createdAt: 4 }] });
    expect(rows.map((r) => [r.name, r.courseId, r.sectionId])).toEqual([["Quiz", "c9", null], ["Old", null, null]]);
  });
  it("a course's exam list is exactly the rows filed under it", () => {
    const rows = dashboardRows({ local: null, localScanCount: null, exams: [cloud({ _id: "a", courseId: "c1", createdAt: 3 }), cloud({ _id: "b", layoutHash: "BBB", courseId: "c2", createdAt: 2 })] });
    expect(courseExamRows(rows, "c1").map((r) => r.key)).toEqual(["a"]);
  });
});
