import { describe, expect, it } from "vitest";
import {
  addSection, courseDesignDefaults, courseExamRows, createCourse, examScopeLabel, MAX_COURSES, MAX_SECTIONS, normalizeSectionNames,
  parseCourseParams, parseSavedCourses, parseSectionList, removeCourse, removeSection, sectionShort, setSectionClass, sectionTags, updateCourse,
  validateCourseFields, type SavedCourse,
} from "@/lib/courses/courses";

let n = 0;
const ctx = () => ({ now: 1000, newId: () => `id${++n}` });
const input = { code: "HM 5", title: "Applied Business Tools", semester: "1st Semester", schoolYear: "2026-2027", sections: ["BS-HM 2A", "BS-HM 2B", "BS-HM 2C"] };
const made = (): SavedCourse => { const r = createCourse([], input, ctx()); if ("error" in r) throw new Error(r.error); return r.saved; };

describe("section names", () => {
  it("splits a typed list on commas and new lines, trims, and drops blanks", () => {
    expect(parseSectionList(" BS-HM 2A, BS-HM 2B ,, \n BS-HM 2C\n")).toEqual(["BS-HM 2A", "BS-HM 2B", "BS-HM 2C"]);
    expect(parseSectionList("")).toEqual([]);
  });
  it("refuses a repeated section (ignoring case), an over-long name, and more than 20 sections", () => {
    expect(normalizeSectionNames(["2A", "2a"])).toEqual({ ok: false, error: "Section 2a appears twice." });
    expect(normalizeSectionNames(["x".repeat(61)])).toMatchObject({ ok: false });
    expect(normalizeSectionNames(Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => `S${i}`))).toMatchObject({ ok: false });
    expect(normalizeSectionNames(Array.from({ length: MAX_SECTIONS }, (_, i) => `S${i}`))).toMatchObject({ ok: true });
    expect(normalizeSectionNames([" 2A ", ""])).toEqual({ ok: true, names: ["2A"] });
  });
  it("shortens 'BS-HM 2A' to the pill label '2A' and keeps single-word names whole", () => {
    expect(sectionShort("BS-HM 2A")).toBe("2A");
    expect(sectionShort("Section A")).toBe("A");
    expect(sectionShort("2B")).toBe("2B");
    expect(sectionShort("Bachelor of Science in Hospitality Management")).toBe("Bachelor of…");
  });
});

describe("course fields", () => {
  it("trims, requires code, title and semester, and bounds every field", () => {
    expect(validateCourseFields({ code: " HM 5 ", title: " T ", semester: " 1st Semester ", schoolYear: " 2026-2027 " })).toEqual({ ok: true, value: { code: "HM 5", title: "T", semester: "1st Semester", schoolYear: "2026-2027" } });
    expect(validateCourseFields({ code: "", title: "T", semester: "S" })).toMatchObject({ ok: false });
    expect(validateCourseFields({ code: "C", title: " ", semester: "S" })).toMatchObject({ ok: false });
    expect(validateCourseFields({ code: "C", title: "T", semester: "" })).toMatchObject({ ok: false });
    expect(validateCourseFields({ code: "c".repeat(41), title: "T", semester: "S" })).toMatchObject({ ok: false });
    expect(validateCourseFields({ code: "C", title: "t".repeat(201), semester: "S" })).toMatchObject({ ok: false });
    expect(validateCourseFields({ code: "C", title: "T", semester: "S", schoolYear: " " })).toEqual({ ok: true, value: { code: "C", title: "T", semester: "S" } });
  });
});

describe("createCourse / updateCourse / removeCourse", () => {
  it("creates a course with lightweight sections (a name and an id, no students)", () => {
    const c = made();
    expect(c).toMatchObject({ code: "HM 5", title: "Applied Business Tools", semester: "1st Semester", schoolYear: "2026-2027", createdAt: 1000 });
    expect(c.sections.map((s) => s.name)).toEqual(["BS-HM 2A", "BS-HM 2B", "BS-HM 2C"]);
    expect(new Set(c.sections.map((s) => s.id)).size).toBe(3);
    expect(c.sections.every((s) => s.classId === undefined)).toBe(true);
  });
  it("allows a course with no sections yet", () => {
    expect(createCourse([], { ...input, sections: [] }, ctx())).toMatchObject({ saved: { sections: [] } });
  });
  it("refuses the same code in the same term twice, but allows it in another term", () => {
    const first = made();
    expect(createCourse([first], { ...input, code: "hm 5", sections: [] }, ctx())).toEqual({ error: "You already have HM 5 for 1st Semester 2026-2027." });
    expect(createCourse([first], { ...input, semester: "2nd Semester", sections: [] }, ctx())).toMatchObject({ saved: { semester: "2nd Semester" } });
  });
  it("stops at the course cap", () => {
    const list = Array.from({ length: MAX_COURSES }, (_, i) => ({ ...made(), id: `c${i}`, code: `C${i}` }));
    expect(createCourse(list, { ...input, code: "ONE MORE", sections: [] }, ctx())).toMatchObject({ error: expect.stringContaining(String(MAX_COURSES)) });
  });
  it("updates the course fields without touching its sections, and never mutates the list", () => {
    const c = made(); const list = [c];
    const r = updateCourse(list, c.id, { code: "HM 5A", title: "New title", semester: "2nd Semester" }, 2000);
    if ("error" in r) throw new Error(r.error);
    expect(r.saved).toMatchObject({ code: "HM 5A", title: "New title", updatedAt: 2000, createdAt: 1000 });
    expect(r.saved.schoolYear).toBeUndefined();
    expect(r.saved.sections).toEqual(c.sections);
    expect(list[0].code).toBe("HM 5");
    expect(updateCourse(list, "nope", { code: "X", title: "Y", semester: "Z" }, 1)).toEqual({ error: "That course no longer exists." });
  });
  it("removes a course", () => {
    const c = made();
    expect(removeCourse([c], c.id)).toEqual([]);
  });
});

describe("sections", () => {
  it("adds a section, refusing duplicates and the 21st", () => {
    const c = made();
    const r = addSection([c], c.id, "BS-HM 2D", ctx());
    if ("error" in r) throw new Error(r.error);
    expect(r.saved.sections.map((s) => s.name)).toEqual(["BS-HM 2A", "BS-HM 2B", "BS-HM 2C", "BS-HM 2D"]);
    expect(addSection([c], c.id, "bs-hm 2a", ctx())).toEqual({ error: "Section bs-hm 2a appears twice." });
    expect(addSection([c], c.id, "  ", ctx())).toEqual({ error: "Give the section a name." });
    const full = { ...c, sections: Array.from({ length: MAX_SECTIONS }, (_, i) => ({ id: `s${i}`, name: `S${i}` })) };
    expect(addSection([full], c.id, "S-new", ctx())).toMatchObject({ error: expect.stringContaining(String(MAX_SECTIONS)) });
  });
  it("removes a section only when no exam is scoped to it", () => {
    const c = made();
    const target = c.sections[1];
    expect(removeSection([c], c.id, target.id, 2)).toEqual({ error: "2 exams are scoped to BS-HM 2B. Delete or move them first." });
    expect(removeSection([c], c.id, target.id, 1)).toEqual({ error: "1 exam is scoped to BS-HM 2B. Delete or move it first." });
    const r = removeSection([c], c.id, target.id, 0);
    if ("error" in r) throw new Error(r.error);
    expect(r.saved.sections.map((s) => s.name)).toEqual(["BS-HM 2A", "BS-HM 2C"]);
    expect(removeSection([c], c.id, "ghost", 0)).toEqual({ error: "That section no longer exists." });
  });
  it("links an existing class to a section (no roster is copied) and unlinks it", () => {
    const c = made(); const sid = c.sections[0].id;
    const r = setSectionClass([c], c.id, sid, "class-1");
    if ("error" in r) throw new Error(r.error);
    expect(r.saved.sections[0]).toEqual({ id: sid, name: "BS-HM 2A", classId: "class-1" });
    expect(Object.keys(r.saved.sections[0]).sort()).toEqual(["classId", "id", "name"]);
    const u = setSectionClass(r.list, c.id, sid, null);
    if ("error" in u) throw new Error(u.error);
    expect(u.saved.sections[0]).toEqual({ id: sid, name: "BS-HM 2A" });
  });
});

describe("exam scope", () => {
  it("labels an unscoped exam 'All sections' and a scoped one 'Section 2A'", () => {
    const c = made();
    expect(examScopeLabel(c, null)).toBe("All sections");
    expect(examScopeLabel(c, undefined)).toBe("All sections");
    expect(examScopeLabel(c, c.sections[0].id)).toBe("Section 2A");
    expect(examScopeLabel(c, "gone")).toBe("All sections");
  });
  it("lists only the exams that belong to the course", () => {
    const rows = [
      { key: "a", courseId: "c1", sectionId: null }, { key: "b", courseId: "c1", sectionId: "s1" },
      { key: "c", courseId: "c2", sectionId: null }, { key: "d" }, { key: "e", courseId: null },
    ];
    expect(courseExamRows(rows, "c1").map((r) => r.key)).toEqual(["a", "b"]);
    expect(courseExamRows(rows, "zzz")).toEqual([]);
  });
});

describe("designer hand-off", () => {
  it("reads ?courseId and an optional ?sectionId; refuses junk", () => {
    expect(parseCourseParams("?courseId=abc123&sectionId=s-9")).toEqual({ courseId: "abc123", sectionId: "s-9" });
    expect(parseCourseParams("?courseId=abc123")).toEqual({ courseId: "abc123", sectionId: null });
    expect(parseCourseParams("?sectionId=s-9")).toBeNull();
    expect(parseCourseParams("")).toBeNull();
    expect(parseCourseParams("?courseId=" + "a".repeat(101))).toBeNull();
    expect(parseCourseParams("?courseId=<script>")).toBeNull();
    expect(parseCourseParams("?courseId=abc&sectionId=%3Cb%3E")).toEqual({ courseId: "abc", sectionId: null });
  });
  it("pre-fills the printed title and the course line, adding the section only when one is chosen", () => {
    const c = made();
    expect(courseDesignDefaults(c, null)).toEqual({ title: "HM 5 Examination", subtitle: "Applied Business Tools - 1st Semester 2026-2027" });
    expect(courseDesignDefaults(c, c.sections[2].id)).toEqual({ title: "HM 5 Examination", subtitle: "Applied Business Tools - BS-HM 2C - 1st Semester 2026-2027" });
    const long = { ...c, title: "t".repeat(120) };
    expect(courseDesignDefaults(long, null).subtitle.length).toBeLessThanOrEqual(80);
    expect(courseDesignDefaults({ ...c, code: "c".repeat(40) }, null).title.length).toBeLessThanOrEqual(80);
  });
});

describe("section tags for the gradebook", () => {
  it("lists each roster section with its count, hides itself when fewer than two sections exist", () => {
    const bySheet = new Map<string, string | undefined>([["1", "2A"], ["2", "2A"], ["3", "2B"], ["4", undefined]]);
    expect(sectionTags(bySheet)).toEqual([{ label: "2A", count: 2 }, { label: "2B", count: 1 }]);
    expect(sectionTags(new Map([["1", "2A"], ["2", "2A"]]))).toEqual([]);
    expect(sectionTags(new Map())).toEqual([]);
    expect(sectionTags(new Map([["1", "  "], ["2", "2A"]]))).toEqual([]);
  });
});

describe("stored courses", () => {
  it("keeps the valid entries and drops damaged ones", () => {
    const c = made();
    expect(parseSavedCourses([c, { id: "x" }, null, "junk"])).toEqual([c]);
    expect(parseSavedCourses("nope")).toEqual([]);
    expect(parseSavedCourses([{ ...c, sections: [{ id: "a", name: "A" }, { id: "a", name: "B" }] }])).toEqual([]);
  });
});
