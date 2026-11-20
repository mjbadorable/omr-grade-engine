import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSectionExamName, validateBulkSectionTargets } from "@/lib/courses/courses";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import { createLocalCourse } from "@/lib/storage/course-library";
import { applyDesignToLocalSections, listLocalExams, upsertLocalExam } from "@/lib/storage/exam-library";
import { readStoredKey, writeStoredKey } from "@/lib/storage/template-store";

const kit = buildSampleExam();

describe("bulk section exam helpers", () => {
  it("formats concise per-section exam titles within max length", () => {
    expect(formatSectionExamName("Midterm Exam", "BS-HM 2A")).toBe("Midterm Exam · 2A");
    expect(formatSectionExamName("  ", "BS-HM 2B")).toBe("Untitled exam · 2B");
    expect(formatSectionExamName("X".repeat(220), "BS-HM 2A", 200).length).toBeLessThanOrEqual(200);
  });

  it("validates and deduplicates section targets against the course", () => {
    const sections = [
      { id: "s1", name: "BS-HM 2A" },
      { id: "s2", name: "BS-HM 2B" },
      { id: "s3", name: "BS-HM 2C" },
    ];
    expect(validateBulkSectionTargets({ sections }, [])).toEqual({ ok: false, error: "Choose at least one section." });
    expect(validateBulkSectionTargets({ sections }, ["s1", "nope"])).toEqual({ ok: false, error: "Section not found in this course." });
    const ok = validateBulkSectionTargets({ sections }, ["s3", "s1", "s3"]);
    expect(ok).toEqual({
      ok: true,
      value: [
        { id: "s1", name: "BS-HM 2A" },
        { id: "s3", name: "BS-HM 2C" },
      ],
    });
  });
});

describe("applyDesignToLocalSections", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies a template across multiple selected sections and files them cleanly", () => {
    const course = createLocalCourse({
      code: "HM 5",
      title: "Applied Business Tools",
      semester: "1st Semester",
      schoolYear: "2026-2027",
      sections: ["BS-HM 1-A", "BS-HM 2-A", "BS-HM 2-B"],
    });
    const targets = [course.sections[0].id, course.sections[2].id];
    const created = applyDesignToLocalSections({
      courseId: course.id,
      sectionIds: targets,
      baseName: "Prelim Quiz",
      template: kit.template,
    });
    expect(created).toHaveLength(2);
    expect(created.map((e) => e.name)).toEqual(["Prelim Quiz · 1-A", "Prelim Quiz · 2-B"]);
    expect(created.map((e) => e.sectionId)).toEqual(targets);
    expect(created.every((e) => e.courseId === course.id && e.template.layoutHash === kit.template.layoutHash)).toBe(true);
    expect(listLocalExams()).toHaveLength(2);
  });

  it("clones an existing exam design into selected sections while keeping folder and answer key", () => {
    const course = createLocalCourse({
      code: "HM 5",
      title: "Applied Business Tools",
      semester: "1st Semester",
      sections: ["2-A", "2-B", "2-C"],
    });
    writeStoredKey(kit.template.layoutHash, kit.key);
    const src = upsertLocalExam(kit.template, { name: "Master Sheet", folderId: "fld-1" });
    const created = applyDesignToLocalSections({
      courseId: course.id,
      sectionIds: course.sections.map((s) => s.id),
      baseName: "Midterm Exam",
      sourceExamId: src.id,
    });
    expect(created.map((e) => e.name)).toEqual(["Midterm Exam · 2-A", "Midterm Exam · 2-B", "Midterm Exam · 2-C"]);
    expect(created.every((e) => e.folderId === "fld-1")).toBe(true);
    expect(readStoredKey(kit.template.layoutHash)?.examId).toBe(kit.key.examId);
  });

  it("wires bulk selection checkboxes and apply controls into Courses, CourseContextBanner, and SheetDesigner", () => {
    const coursesUi = readFileSync(join(process.cwd(), "src/components/courses/Courses.tsx"), "utf8");
    for (const id of ["select-all-sections", "section-select-checkbox", "bulk-apply-bar", "bulk-apply-source", "bulk-apply-submit"]) {
      expect(coursesUi).toContain(id);
    }

    const banner = readFileSync(join(process.cwd(), "src/components/designer/CourseContextBanner.tsx"), "utf8");
    for (const id of ["designer-bulk-toggle", "designer-bulk-panel", "designer-bulk-apply", "[@media(pointer:coarse)]:min-h-11"]) {
      expect(banner).toContain(id);
    }
  });
});
