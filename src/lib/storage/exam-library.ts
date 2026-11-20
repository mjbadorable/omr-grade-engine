/**
 * Local-first exam library and semester folder store (localStorage).
 * Lets teachers copy set-up exams, organize them into stored semester folders,
 * archive/restore them, and delete them even without a Convex cloud connection.
 */
import type { DashboardRow } from "@/lib/dashboard";
import { formatSectionExamName, parseSavedCourses, validateBulkSectionTargets, type SavedCourse } from "@/lib/courses/courses";
import type { OMRTemplate } from "@/lib/omr/schema";
import { TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import { readStoredKey, readStoredTemplate, TEMPLATE_STORAGE_KEY, writeStoredKey, writeStoredTemplate } from "@/lib/storage/template-store";

export const LOCAL_EXAMS_KEY = "omr:localExams";
export const LOCAL_FOLDERS_KEY = "omr:localFolders";

export interface LocalFolder {
  id: string;
  name: string;
  semester: string;
  schoolYear: string | null;
  createdAt: number;
}

export interface LocalExamRecord {
  id: string;
  name: string;
  template: OMRTemplate;
  folderId: string | null;
  /** course this exam is filed under; absent on exams saved before courses existed */
  courseId?: string | null;
  /** null / absent inside a course = All sections */
  sectionId?: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const SEMESTER_OPTIONS = [
  "1st Semester",
  "2nd Semester",
  "Summer",
  "Midyear",
] as const;

function uid(prefix: string): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${r}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function writeJsonStrict(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("Browser storage is full. Delete an old exam or free up space before saving.");
  }
}

function notifyLibraryChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TEMPLATE_CHANGED_EVENT));
  }
}

export function listLocalFolders(): LocalFolder[] {
  const list = readJson<LocalFolder[]>(LOCAL_FOLDERS_KEY, []);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export function createLocalFolder(input: { name: string; semester: string; schoolYear?: string | null }): LocalFolder {
  const name = input.name.trim();
  const semester = input.semester.trim() || "1st Semester";
  const schoolYear = input.schoolYear?.trim() || null;
  if (!name) throw new Error("Folder name is required.");
  const existing = readJson<LocalFolder[]>(LOCAL_FOLDERS_KEY, []);
  if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A folder with this name already exists.");
  }
  const folder: LocalFolder = { id: uid("fld"), name, semester, schoolYear, createdAt: Date.now() };
  writeJsonStrict(LOCAL_FOLDERS_KEY, [folder, ...existing]);
  notifyLibraryChanged();
  return folder;
}

export function deleteLocalFolder(folderId: string): void {
  const folders = readJson<LocalFolder[]>(LOCAL_FOLDERS_KEY, []).filter((f) => f.id !== folderId);
  writeJson(LOCAL_FOLDERS_KEY, folders);
  const exams = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []).map((e) =>
    e.folderId === folderId ? { ...e, folderId: null, updatedAt: Date.now() } : e,
  );
  writeJson(LOCAL_EXAMS_KEY, exams);
  notifyLibraryChanged();
}

/** A new course binding when one is given (a section only makes sense inside a course); otherwise the exam keeps its own. */
function courseBinding(opts: { courseId?: string | null; sectionId?: string | null }, cur: LocalExamRecord): Pick<LocalExamRecord, "courseId" | "sectionId"> {
  if (opts.courseId === undefined) return { courseId: cur.courseId ?? null, sectionId: cur.sectionId ?? null };
  return { courseId: opts.courseId, sectionId: opts.courseId ? opts.sectionId ?? null : null };
}

/** Exams of this course (or of one of its sections) that are stored on this device. */
export const countLocalCourseExams = (courseId: string, sectionId?: string): number =>
  readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []).filter((e) => e.courseId === courseId && (sectionId === undefined || e.sectionId === sectionId)).length;

/** Deleting a course keeps its exams (and everything graded on them); they simply become unfiled. */
export function unassignLocalCourseExams(courseId: string): void {
  const now = Date.now();
  writeJson(LOCAL_EXAMS_KEY, readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []).map((e) => (e.courseId === courseId ? { ...e, courseId: null, sectionId: null, updatedAt: now } : e)));
  notifyLibraryChanged();
}

export function listLocalExams(): LocalExamRecord[] {
  const list = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export function upsertLocalExam(
  template: OMRTemplate,
  opts: { name?: string; folderId?: string | null; courseId?: string | null; sectionId?: string | null } = {},
): LocalExamRecord {
  const exams = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []);
  const now = Date.now();
  const name = (opts.name ?? template.title ?? "").trim() || template.templateId || "Untitled exam";
  const idx = exams.findIndex((e) => e.template.layoutHash === template.layoutHash);
  if (idx >= 0) {
    const updated: LocalExamRecord = {
      ...exams[idx],
      name,
      template,
      folderId: opts.folderId !== undefined ? opts.folderId : exams[idx].folderId,
      ...courseBinding(opts, exams[idx]),
      updatedAt: now,
    };
    const next = [...exams];
    next[idx] = updated;
    writeJson(LOCAL_EXAMS_KEY, next);
    return updated;
  }
  const created: LocalExamRecord = {
    id: uid("exam"),
    name,
    template,
    folderId: opts.folderId ?? null,
    courseId: opts.courseId ?? null,
    sectionId: opts.courseId ? opts.sectionId ?? null : null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  writeJson(LOCAL_EXAMS_KEY, [created, ...exams]);
  return created;
}

export function duplicateLocalExam(examId: string, opts: { name?: string; folderId?: string | null } = {}): LocalExamRecord | null {
  const exams = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []);
  const src = exams.find((e) => e.id === examId);
  if (!src) return null;
  const now = Date.now();
  const copyName = (opts.name ?? `${src.name} (Copy)`).trim() || `${src.name} (Copy)`;
  const clonedTemplate: OMRTemplate = { ...src.template, title: copyName };
  const copy: LocalExamRecord = {
    id: uid("exam"),
    name: copyName,
    template: clonedTemplate,
    folderId: opts.folderId !== undefined ? opts.folderId : src.folderId,
    courseId: src.courseId ?? null,
    sectionId: src.sectionId ?? null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const key = readStoredKey(src.template.layoutHash);
  if (key) writeStoredKey(clonedTemplate.layoutHash, key);
  writeJsonStrict(LOCAL_EXAMS_KEY, [copy, ...exams]);
  notifyLibraryChanged();
  return copy;
}

export function archiveLocalExam(examId: string, archived: boolean): void {
  const now = Date.now();
  const exams = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []).map((e) =>
    e.id === examId ? { ...e, archivedAt: archived ? now : null, updatedAt: now } : e,
  );
  writeJson(LOCAL_EXAMS_KEY, exams);
  notifyLibraryChanged();
}

export function assignLocalExamFolder(examId: string, folderId: string | null): void {
  const now = Date.now();
  const exams = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []).map((e) =>
    e.id === examId ? { ...e, folderId, updatedAt: now } : e,
  );
  writeJson(LOCAL_EXAMS_KEY, exams);
  notifyLibraryChanged();
}

export function deleteLocalExam(examId: string): void {
  const exams = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []);
  const target = exams.find((e) => e.id === examId);
  const remaining = exams.filter((e) => e.id !== examId);
  writeJson(LOCAL_EXAMS_KEY, remaining);

  const active = readStoredTemplate();
  if (target && active && active.layoutHash === target.template.layoutHash && !remaining.some((e) => e.template.layoutHash === active.layoutHash)) {
    const nextActive = remaining.find((e) => !e.archivedAt);
    if (nextActive) {
      writeStoredTemplate(nextActive.template);
    } else {
      try { localStorage.removeItem(TEMPLATE_STORAGE_KEY); } catch { /* ignore */ }
    }
  }
  notifyLibraryChanged();
}

export function activateLocalExam(examId: string): LocalExamRecord | null {
  const exam = listLocalExams().find((e) => e.id === examId) ?? null;
  if (exam) {
    writeStoredTemplate(exam.template);
    notifyLibraryChanged();
  }
  return exam;
}

/** Create one filed exam copy per checked course section from a template or existing local exam. */
export function applyDesignToLocalSections(input: {
  courseId: string;
  sectionIds: readonly string[];
  baseName?: string;
  sourceExamId?: string | null;
  template?: OMRTemplate | null;
}): LocalExamRecord[] {
  const courses = parseSavedCourses(readJson<unknown>("omr:courses", []));
  const course: SavedCourse | undefined = courses.find((c) => c.id === input.courseId);
  if (!course) throw new Error("Course not found.");
  const targets = validateBulkSectionTargets(course, input.sectionIds);
  if (!targets.ok) throw new Error(targets.error);

  const exams = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []);
  const src = input.sourceExamId ? exams.find((e) => e.id === input.sourceExamId) : undefined;
  if (input.sourceExamId && !src) throw new Error("Source exam design not found.");
  const baseTemplate = src?.template ?? input.template;
  if (!baseTemplate) throw new Error("Choose an exam design to apply.");

  const rawBase = (input.baseName ?? src?.name ?? baseTemplate.title ?? "").trim() || baseTemplate.templateId || "Untitled exam";
  const folderId = src?.folderId ?? null;
  const srcKey = readStoredKey(baseTemplate.layoutHash);
  const now = Date.now();

  const created: LocalExamRecord[] = targets.value.map((sec) => {
    const name = formatSectionExamName(rawBase, sec.name);
    const tpl: OMRTemplate = { ...baseTemplate, title: name };
    if (srcKey) writeStoredKey(tpl.layoutHash, srcKey);
    return {
      id: uid("exam"),
      name,
      template: tpl,
      folderId,
      courseId: course.id,
      sectionId: sec.id,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  writeJsonStrict(LOCAL_EXAMS_KEY, [...created, ...exams]);
  notifyLibraryChanged();
  return created;
}

export function filterDashboardRows(
  rows: readonly DashboardRow[],
  opts: { showArchived: boolean; folderId: string | "all" | "unfiled" },
): DashboardRow[] {
  return rows.filter((r) => {
    const isArchived = r.archivedAt !== null && r.archivedAt !== undefined;
    if (opts.showArchived ? !isArchived : isArchived) return false;
    if (opts.folderId === "all") return true;
    if (opts.folderId === "unfiled") return !r.folderId;
    return r.folderId === opts.folderId;
  });
}

