/**
 * Courses and their sections (pure). A course is a subject taught in a term ("HM 5 · 1st Semester 2026-2027");
 * its sections are just names ("BS-HM 2A") that may optionally point at a class the teacher already saved, so
 * student lists live in exactly one place (`classes`). An exam is filed under a course and either covers
 * every section (no section id, the default) or one section. The same rules run in the browser, on this
 * device (storage/course-library.ts) and on the server (convex/courses.ts).
 */
import { z } from "zod";

export const MAX_COURSES = 100;
export const MAX_SECTIONS = 20;
export const MAX_CODE = 40;
export const MAX_TITLE = 200;
export const MAX_TERM = 80;
export const MAX_SECTION_NAME = 60;
/** the printed exam title and course line are capped at 80 characters by the sheet schema */
const SHEET_TEXT = 80;

export interface CourseSection { id: string; name: string; classId?: string }
export interface CourseFields { code: string; title: string; semester: string; schoolYear?: string; syllabusId?: string }
export interface SavedCourse extends CourseFields { id: string; sections: CourseSection[]; createdAt: number; updatedAt: number }
export interface CourseInput extends CourseFields { sections?: readonly string[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type ListResult = { list: SavedCourse[]; saved: SavedCourse } | { error: string };
interface Ctx { now: number; newId: () => string }

// ---- sections

/** "BS-HM 2A, BS-HM 2B\nBS-HM 2C" → three names. */
export const parseSectionList = (text: string): string[] => text.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);

export function normalizeSectionNames(names: readonly string[]): { ok: true; names: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (name.length > MAX_SECTION_NAME) return { ok: false, error: `A section name can be at most ${MAX_SECTION_NAME} characters.` };
    const k = name.toLowerCase();
    if (seen.has(k)) return { ok: false, error: `Section ${name} appears twice.` };
    seen.add(k);
    out.push(name);
  }
  if (out.length > MAX_SECTIONS) return { ok: false, error: `A course can have at most ${MAX_SECTIONS} sections.` };
  return { ok: true, names: out };
}

/** The short pill label: "BS-HM 2A" → "2A"; a single short word stays whole; anything long is cut. */
export function sectionShort(name: string): string {
  const n = name.trim();
  const parts = n.split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last.length <= 8) return last;
  return n.length <= 12 ? n : `${n.slice(0, 11).trimEnd()}…`;
}

// ---- course fields

export function validateCourseFields(f: CourseFields): Result<CourseFields> {
  const code = f.code.trim(), title = f.title.trim(), semester = f.semester.trim(), schoolYear = f.schoolYear?.trim();
  if (!code) return { ok: false, error: "Give the course a code." };
  if (!title) return { ok: false, error: "Give the course a title." };
  if (!semester) return { ok: false, error: "Choose a semester." };
  if (code.length > MAX_CODE) return { ok: false, error: `The course code can be at most ${MAX_CODE} characters.` };
  if (title.length > MAX_TITLE) return { ok: false, error: `The course title can be at most ${MAX_TITLE} characters.` };
  if (semester.length > MAX_TERM) return { ok: false, error: `The semester can be at most ${MAX_TERM} characters.` };
  if (schoolYear && schoolYear.length > MAX_TERM) return { ok: false, error: `The school year can be at most ${MAX_TERM} characters.` };
  return { ok: true, value: { code, title, semester, ...(schoolYear ? { schoolYear } : {}), ...(f.syllabusId ? { syllabusId: f.syllabusId } : {}) } };
}

const termOf = (c: Pick<CourseFields, "semester" | "schoolYear">) => [c.semester, c.schoolYear].filter(Boolean).join(" ");
const sameCourse = (a: CourseFields, b: CourseFields) => a.code.toLowerCase() === b.code.toLowerCase() && termOf(a).toLowerCase() === termOf(b).toLowerCase();
export const duplicateError = (existing: CourseFields) => `You already have ${existing.code} for ${termOf(existing)}.`;
/** The course (other than `exceptId`) that has the same code in the same term, if any. */
export const findDuplicateCourse = <T extends CourseFields & { id: string }>(list: readonly T[], f: CourseFields, exceptId?: string): T | undefined =>
  list.find((c) => c.id !== exceptId && sameCourse(c, f));

/** Create a course (and its sections). Never mutates `list`. */
export function createCourse(list: readonly SavedCourse[], input: CourseInput, ctx: Ctx): ListResult {
  const f = validateCourseFields(input);
  if (!f.ok) return { error: f.error };
  const s = normalizeSectionNames(input.sections ?? []);
  if (!s.ok) return { error: s.error };
  const dup = findDuplicateCourse(list, f.value);
  if (dup) return { error: duplicateError(dup) };
  if (list.length >= MAX_COURSES) return { error: `You can keep at most ${MAX_COURSES} courses. Remove one first.` };
  const saved: SavedCourse = { ...f.value, id: ctx.newId(), sections: s.names.map((name) => ({ id: ctx.newId(), name })), createdAt: ctx.now, updatedAt: ctx.now };
  return { list: [...list, saved], saved };
}

/** Replace the course fields; sections are managed separately. */
export function updateCourse(list: readonly SavedCourse[], id: string, fields: CourseFields, now: number): ListResult {
  const cur = list.find((c) => c.id === id);
  if (!cur) return { error: "That course no longer exists." };
  const f = validateCourseFields(fields);
  if (!f.ok) return { error: f.error };
  const dup = findDuplicateCourse(list, f.value, id);
  if (dup) return { error: duplicateError(dup) };
  const saved: SavedCourse = { ...f.value, id: cur.id, sections: cur.sections, createdAt: cur.createdAt, updatedAt: now };
  return { list: list.map((c) => (c.id === id ? saved : c)), saved };
}

export const removeCourse = (list: readonly SavedCourse[], id: string): SavedCourse[] => list.filter((c) => c.id !== id);

function withSections(list: readonly SavedCourse[], id: string, now: number | undefined, change: (c: SavedCourse) => CourseSection[] | { error: string }): ListResult {
  const cur = list.find((c) => c.id === id);
  if (!cur) return { error: "That course no longer exists." };
  const sections = change(cur);
  if ("error" in sections) return sections;
  const saved: SavedCourse = { ...cur, sections, updatedAt: now ?? cur.updatedAt };
  return { list: list.map((c) => (c.id === id ? saved : c)), saved };
}

export function addSection(list: readonly SavedCourse[], courseId: string, name: string, ctx: Ctx): ListResult {
  if (!name.trim()) return { error: "Give the section a name." };
  return withSections(list, courseId, ctx.now, (c) => {
    const names = normalizeSectionNames([...c.sections.map((s) => s.name), name]);
    return names.ok ? [...c.sections, { id: ctx.newId(), name: name.trim() }] : { error: names.error };
  });
}

/** `scopedExams`: how many exams are scoped to this section. Those must be moved or deleted first. */
export function removeSection(list: readonly SavedCourse[], courseId: string, sectionId: string, scopedExams: number, now?: number): ListResult {
  return withSections(list, courseId, now, (c) => {
    const s = c.sections.find((x) => x.id === sectionId);
    if (!s) return { error: "That section no longer exists." };
    if (scopedExams > 0) return { error: `${scopedExams} ${scopedExams === 1 ? "exam is" : "exams are"} scoped to ${s.name}. Delete or move ${scopedExams === 1 ? "it" : "them"} first.` };
    return c.sections.filter((x) => x.id !== sectionId);
  });
}

/** Point a section at a class the teacher already saved (no student data is copied), or unlink it. */
export function setSectionClass(list: readonly SavedCourse[], courseId: string, sectionId: string, classId: string | null, now?: number): ListResult {
  return withSections(list, courseId, now, (c) => {
    if (!c.sections.some((x) => x.id === sectionId)) return { error: "That section no longer exists." };
    return c.sections.map((x) => {
      if (x.id !== sectionId) return x;
      const { id, name } = x;
      return classId ? { id, name, classId } : { id, name };
    });
  });
}

// ---- exams inside a course

/** "All sections" (no section id) or "Section 2A". */
export function examScopeLabel(course: Pick<SavedCourse, "sections"> | null | undefined, sectionId: string | null | undefined): string {
  const s = sectionId ? course?.sections.find((x) => x.id === sectionId) : undefined;
  return s ? `Section ${sectionShort(s.name)}` : "All sections";
}

export const courseExamRows = <T extends { courseId?: string | null }>(rows: readonly T[], courseId: string): T[] => rows.filter((r) => r.courseId === courseId);

// ---- course exam scope filter (the pill bar above Course Examinations)

/** Filter key for exams that cover every section (no section id, or a section that no longer exists). "" means no filter. */
export const ALL_SECTIONS_KEY = "__all_sections__";
type Scoped = { sectionId?: string | null };
type WithSections = Pick<SavedCourse, "sections">;

const scopeKeyOf = (course: WithSections, sectionId: string | null | undefined): string =>
  sectionId && course.sections.some((s) => s.id === sectionId) ? sectionId : ALL_SECTIONS_KEY;

export interface ExamScopeOption { key: string; label: string; count: number }

/** Pills: All, "All sections" (when an exam covers them), then every section of the course, each with its exam count. */
export function examScopeOptions(course: WithSections, rows: readonly Scoped[]): ExamScopeOption[] {
  const count = (key: string) => rows.filter((r) => scopeKeyOf(course, r.sectionId) === key).length;
  const out: ExamScopeOption[] = [{ key: "", label: "All", count: rows.length }];
  const whole = count(ALL_SECTIONS_KEY);
  if (whole > 0) out.push({ key: ALL_SECTIONS_KEY, label: "All sections", count: whole });
  for (const s of course.sections) out.push({ key: s.id, label: s.name, count: count(s.id) });
  return out;
}

/** Keeps the rows in their order. "" = everything; an unknown key matches nothing. */
export function filterExamsByScope<T extends Scoped>(course: WithSections, rows: readonly T[], key: string): T[] {
  return key === "" ? [...rows] : rows.filter((r) => scopeKeyOf(course, r.sectionId) === key);
}

/** The filter is only worth showing when the exams span two or more scopes. */
export const hasScopeChoice = (course: WithSections, rows: readonly Scoped[]): boolean => new Set(rows.map((r) => scopeKeyOf(course, r.sectionId))).size >= 2;

export function scopeOptionLabel(course: WithSections, key: string): string {
  if (key === "") return "All";
  if (key === ALL_SECTIONS_KEY) return "All sections";
  return course.sections.find((s) => s.id === key)?.name ?? "this section";
}

/** Format a per-section exam name such as "Midterm Exam · 2A", staying within `maxLen`. */
export function formatSectionExamName(baseName: string, sectionName: string, maxLen = 200): string {
  const base = baseName.trim() || "Untitled exam";
  const suffix = ` · ${sectionShort(sectionName)}`;
  if (base.length + suffix.length <= maxLen) return `${base}${suffix}`;
  return `${base.slice(0, Math.max(1, maxLen - suffix.length)).trimEnd()}${suffix}`;
}

/** Validate selected section ids against a course, deduplicating in the course's section order. */
export function validateBulkSectionTargets(
  course: Pick<SavedCourse, "sections">,
  sectionIds: readonly string[],
): Result<CourseSection[]> {
  if (sectionIds.length === 0) return { ok: false, error: "Choose at least one section." };
  const byId = new Map(course.sections.map((s) => [s.id, s]));
  const picked = new Set<string>();
  for (const id of sectionIds) {
    if (!byId.has(id)) return { ok: false, error: "Section not found in this course." };
    picked.add(id);
  }
  if (picked.size > MAX_SECTIONS) return { ok: false, error: `Select at most ${MAX_SECTIONS} sections.` };
  return { ok: true, value: course.sections.filter((s) => picked.has(s.id)) };
}

const PARAM = /^[A-Za-z0-9_-]{1,100}$/;
/** `?courseId=…&sectionId=…` handed to the designer. Anything that does not look like an id is ignored. */
export function parseCourseParams(search: string): { courseId: string; sectionId: string | null } | null {
  const p = new URLSearchParams(search);
  const courseId = p.get("courseId");
  if (!courseId || !PARAM.test(courseId)) return null;
  const sectionId = p.get("sectionId");
  return { courseId, sectionId: sectionId && PARAM.test(sectionId) ? sectionId : null };
}

/** Printed title and course line for an exam designed inside a course (and, optionally, one of its sections). */
export function courseDesignDefaults(course: SavedCourse, sectionId: string | null): { title: string; subtitle: string } {
  const section = sectionId ? course.sections.find((s) => s.id === sectionId) : undefined;
  return {
    title: `${course.code} Examination`.slice(0, SHEET_TEXT),
    subtitle: [course.title, section?.name, termOf(course)].filter(Boolean).join(" - ").slice(0, SHEET_TEXT),
  };
}

/** Gradebook pills: the sections found on the roster, with counts. Empty (hidden) unless there are at least two. */
export function sectionTags(sectionBySheet: ReadonlyMap<string, string | undefined>): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const raw of sectionBySheet.values()) {
    const label = raw?.trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// ---- storage

const SectionSchema = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(MAX_SECTION_NAME), classId: z.string().min(1).max(100).optional() });
const SavedCourseSchema = z.object({
  id: z.string().min(1).max(100), code: z.string().min(1).max(MAX_CODE), title: z.string().min(1).max(MAX_TITLE), semester: z.string().min(1).max(MAX_TERM),
  schoolYear: z.string().min(1).max(MAX_TERM).optional(), syllabusId: z.string().min(1).max(100).optional(),
  sections: z.array(SectionSchema).max(MAX_SECTIONS).refine((l) => new Set(l.map((s) => s.id)).size === l.length, "Section ids must be unique."),
  createdAt: z.number(), updatedAt: z.number(),
});

/** Whatever storage returns → only the courses that are still valid (a damaged entry never breaks the rest). */
export function parseSavedCourses(raw: unknown): SavedCourse[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => { const r = SavedCourseSchema.safeParse(x); return r.success ? [r.data as SavedCourse] : []; });
}
