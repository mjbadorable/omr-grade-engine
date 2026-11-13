import { beforeEach, describe, expect, it } from "vitest";
import { keyFromTemplate } from "@/lib/grading/answer-key";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import { readStoredKey, writeStoredKey } from "@/lib/storage/template-store";
import {
  archiveLocalExam,
  assignLocalExamFolder,
  createLocalFolder,
  deleteLocalExam,
  deleteLocalFolder,
  duplicateLocalExam,
  filterDashboardRows,
  listLocalExams,
  listLocalFolders,
  upsertLocalExam,
} from "@/lib/storage/exam-library";
import type { DashboardRow } from "@/lib/dashboard";

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
};

describe("local exam library & semester folders", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true });
  });

  it("creates, lists, and deletes semester folders while unassigning exams", () => {
    const f1 = createLocalFolder({ name: "1st Sem 2026-2027", semester: "1st Semester", schoolYear: "2026-2027" });
    const f2 = createLocalFolder({ name: "2nd Sem 2026-2027", semester: "2nd Semester" });
    expect(listLocalFolders().map((f) => f.id)).toEqual([f2.id, f1.id]);

    const t = { ...buildSampleExam().template, title: "Midterm" };
    const exam = upsertLocalExam(t);
    assignLocalExamFolder(exam.id, f1.id);
    expect(listLocalExams()[0].folderId).toBe(f1.id);

    deleteLocalFolder(f1.id);
    expect(listLocalFolders().map((f) => f.id)).toEqual([f2.id]);
    expect(listLocalExams()[0].folderId).toBeNull();
  });

  it("duplicates a set-up exam (template + answer key + folder) with a distinct copy name", () => {
    const t = { ...buildSampleExam().template, title: "Prelim Physics" };
    const key = keyFromTemplate(t, "local-1");
    writeStoredKey(t.layoutHash, key);

    const folder = createLocalFolder({ name: "1st Sem 2026-2027", semester: "1st Semester" });
    const original = upsertLocalExam(t, { folderId: folder.id });
    const copy = duplicateLocalExam(original.id);

    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(original.id);
    expect(copy!.name).toBe("Prelim Physics (Copy)");
    expect(copy!.folderId).toBe(folder.id);
    expect(copy!.template.layoutHash).toBe(original.template.layoutHash);
    expect(readStoredKey(copy!.template.layoutHash)).not.toBeNull();
    expect(listLocalExams()).toHaveLength(2);
  });

  it("archives, restores, and deletes examinations", () => {
    const t = { ...buildSampleExam().template, title: "Quiz 1" };
    const exam = upsertLocalExam(t);
    expect(exam.archivedAt).toBeNull();

    archiveLocalExam(exam.id, true);
    expect(listLocalExams()[0].archivedAt).not.toBeNull();

    archiveLocalExam(exam.id, false);
    expect(listLocalExams()[0].archivedAt).toBeNull();

    deleteLocalExam(exam.id);
    expect(listLocalExams()).toHaveLength(0);
  });

  it("filters dashboard rows by archived flag and semester folder", () => {
    const rows: DashboardRow[] = [
      { key: "1", examId: "1", name: "Active Sem1", where: "Workspace", status: "Open", period: null, scanned: 0, createdAt: 10, archivedAt: null, folderId: "sem1" },
      { key: "2", examId: "2", name: "Active Sem2", where: "Workspace", status: "Open", period: null, scanned: 0, createdAt: 9, archivedAt: null, folderId: "sem2" },
      { key: "3", examId: "3", name: "Archived Sem1", where: "Workspace", status: "Closed", period: null, scanned: 2, createdAt: 8, archivedAt: 1000, folderId: "sem1" },
    ];
    expect(filterDashboardRows(rows, { showArchived: false, folderId: "all" }).map((r) => r.key)).toEqual(["1", "2"]);
    expect(filterDashboardRows(rows, { showArchived: true, folderId: "all" }).map((r) => r.key)).toEqual(["3"]);
    expect(filterDashboardRows(rows, { showArchived: false, folderId: "sem1" }).map((r) => r.key)).toEqual(["1"]);
    expect(filterDashboardRows(rows, { showArchived: true, folderId: "sem1" }).map((r) => r.key)).toEqual(["3"]);
  });
});
