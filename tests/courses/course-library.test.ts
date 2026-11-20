import { beforeEach, describe, expect, it } from "vitest";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import {
  addLocalSection, clearCourseBinding, createLocalCourse, deleteLocalCourse, getLocalCourse, listLocalCourses, readCourseBinding,
  removeLocalSection, setLocalSectionClass, updateLocalCourse, writeCourseBinding,
} from "@/lib/storage/course-library";
import { deleteLocalFolder, createLocalFolder, assignLocalExamFolder, duplicateLocalExam, listLocalExams, upsertLocalExam, applyDesignToLocalSections } from "@/lib/storage/exam-library";

const memoryStorage = () => {
  const store = new Map<string, string>();
  return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() };
};
const tpl = (title = "Midterm") => ({ ...buildSampleExam().template, title });
const input = { code: "HM 5", title: "Applied Business Tools", semester: "1st Semester", schoolYear: "2026-2027", sections: ["BS-HM 2A", "BS-HM 2B", "BS-HM 2C"] };

beforeEach(() => { Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true }); });

describe("local course library mirrors the cloud API", () => {
  it("creates a course with three sections and lists it", () => {
    const c = createLocalCourse(input);
    expect(listLocalCourses().map((x) => x.id)).toEqual([c.id]);
    expect(getLocalCourse(c.id)?.sections.map((s) => s.name)).toEqual(["BS-HM 2A", "BS-HM 2B", "BS-HM 2C"]);
  });
  it("throws the same messages the cloud returns for invalid input and duplicates", () => {
    createLocalCourse(input);
    expect(() => createLocalCourse({ ...input, sections: [] })).toThrow("You already have HM 5 for 1st Semester 2026-2027.");
    expect(() => createLocalCourse({ ...input, code: "", sections: [] })).toThrow("Give the course a code.");
    expect(() => createLocalCourse({ ...input, code: "X", sections: ["a", "A"] })).toThrow("Section A appears twice.");
  });
  it("edits the course fields, adds and removes sections, and links a class", () => {
    const c = createLocalCourse(input);
    updateLocalCourse(c.id, { code: "HM 5A", title: "New", semester: "2nd Semester" });
    addLocalSection(c.id, "BS-HM 2D");
    const after = getLocalCourse(c.id)!;
    expect(after).toMatchObject({ code: "HM 5A", title: "New" });
    expect(after.sections).toHaveLength(4);
    setLocalSectionClass(c.id, after.sections[0].id, "class-1");
    expect(getLocalCourse(c.id)!.sections[0].classId).toBe("class-1");
    removeLocalSection(c.id, after.sections[3].id);
    expect(getLocalCourse(c.id)!.sections).toHaveLength(3);
  });
  it("ignores damaged storage instead of crashing", () => {
    localStorage.setItem("omr:courses", "{not json");
    expect(listLocalCourses()).toEqual([]);
  });
});

describe("exams filed in a course (local)", () => {
  it("files an exam in the course; sectionId null means All sections", () => {
    const c = createLocalCourse(input);
    const e = upsertLocalExam(tpl(), { courseId: c.id, sectionId: null });
    expect(e).toMatchObject({ courseId: c.id, sectionId: null });
    const e2 = upsertLocalExam(tpl("Quiz 2"), { courseId: c.id, sectionId: c.sections[0].id });
    expect(e2.sectionId).toBe(c.sections[0].id);
  });
  it("re-saving the same sheet without a binding keeps the existing one", () => {
    const c = createLocalCourse(input);
    upsertLocalExam(tpl(), { courseId: c.id, sectionId: c.sections[1].id });
    const again = upsertLocalExam(tpl());
    expect(again).toMatchObject({ courseId: c.id, sectionId: c.sections[1].id });
  });
  it("older stored exams (no course fields) read as unfiled", () => {
    localStorage.setItem("omr:localExams", JSON.stringify([{ id: "old", name: "Old", template: tpl(), folderId: null, archivedAt: null, createdAt: 1, updatedAt: 1 }]));
    expect(listLocalExams()[0].courseId ?? null).toBeNull();
  });
  it("a copy stays in the same course and section", () => {
    const c = createLocalCourse(input);
    const e = upsertLocalExam(tpl(), { courseId: c.id, sectionId: c.sections[0].id });
    const copy = duplicateLocalExam(e.id)!;
    expect(copy).toMatchObject({ courseId: c.id, sectionId: c.sections[0].id });
  });
  it("deleting a course unassigns its exams (they and their data survive)", () => {
    const c = createLocalCourse(input);
    const other = createLocalCourse({ ...input, code: "HM 6", sections: ["X"] });
    upsertLocalExam(tpl("A"), { courseId: c.id, sectionId: c.sections[0].id });
    upsertLocalExam({ ...tpl("B"), layoutHash: "BBBB" }, { courseId: other.id, sectionId: null });
    deleteLocalCourse(c.id);
    const exams = listLocalExams();
    expect(exams).toHaveLength(2);
    expect(exams.find((e) => e.name === "A")).toMatchObject({ courseId: null, sectionId: null });
    expect(exams.find((e) => e.name === "B")?.courseId).toBe(other.id);
    expect(listLocalCourses().map((x) => x.id)).toEqual([other.id]);
  });
  it("refuses to remove a section that an exam is scoped to", () => {
    const c = createLocalCourse(input);
    upsertLocalExam(tpl(), { courseId: c.id, sectionId: c.sections[0].id });
    expect(() => removeLocalSection(c.id, c.sections[0].id)).toThrow("1 exam is scoped to BS-HM 2A. Delete or move it first.");
    expect(() => removeLocalSection(c.id, c.sections[1].id)).not.toThrow();
  });
  it("semester folders keep working next to courses", () => {
    const c = createLocalCourse(input);
    const f = createLocalFolder({ name: "1st Sem", semester: "1st Semester" });
    const e = upsertLocalExam(tpl(), { courseId: c.id, sectionId: null });
    assignLocalExamFolder(e.id, f.id);
    deleteLocalFolder(f.id);
    expect(listLocalExams()[0]).toMatchObject({ folderId: null, courseId: c.id });
  });
});

describe("course binding hand-off (designer → save)", () => {
  it("remembers which course the sheet being designed belongs to", () => {
    expect(readCourseBinding()).toBeNull();
    writeCourseBinding({ templateId: "tpl-1", courseId: "c1", sectionId: null });
    expect(readCourseBinding()).toEqual({ templateId: "tpl-1", courseId: "c1", sectionId: null });
    clearCourseBinding();
    expect(readCourseBinding()).toBeNull();
  });
  it("ignores a damaged binding", () => {
    localStorage.setItem("omr:courseBinding", JSON.stringify({ templateId: 5 }));
    expect(readCourseBinding()).toBeNull();
  });
});

describe("local storage quota errors surface cleanly", () => {
  it("createLocalCourse and applyDesignToLocalSections throw when storage.setItem fails", () => {
    const c = createLocalCourse(input);
    const full = {
      ...memoryStorage(),
      getItem: (k: string) => globalThis.localStorage.getItem(k),
      setItem: () => { throw new DOMException("QuotaExceededError"); },
    };
    const prev = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => prev.getItem(k),
        setItem: () => { throw new DOMException("QuotaExceededError"); },
        removeItem: (k: string) => prev.removeItem(k),
        clear: () => prev.clear(),
      },
      configurable: true,
    });
    void full;
    expect(() => createLocalCourse({ ...input, code: "HM 9" })).toThrow(/storage/i);
    expect(() => applyDesignToLocalSections({ courseId: c.id, sectionIds: [c.sections[0].id], template: tpl() })).toThrow(/storage/i);
  });
});
