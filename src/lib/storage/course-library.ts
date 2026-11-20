/**
 * Local-first course library (localStorage): the same API and rules as the cloud `courses` functions, so a
 * teacher without a workspace connection gets identical behaviour. Functions throw an Error with the
 * user-facing message, like the semester-folder helpers next to it.
 */
import { TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import {
  addSection, createCourse, parseSavedCourses, removeCourse, removeSection, setSectionClass, updateCourse,
  type CourseFields, type CourseInput, type SavedCourse,
} from "@/lib/courses/courses";
import { countLocalCourseExams, unassignLocalCourseExams } from "@/lib/storage/exam-library";

export const LOCAL_COURSES_KEY = "omr:courses";
const BINDING_KEY = "omr:courseBinding";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 36);

function read(): SavedCourse[] {
  try { return parseSavedCourses(JSON.parse(localStorage.getItem(LOCAL_COURSES_KEY) ?? "[]")); } catch { return []; }
}
function write(list: readonly SavedCourse[]): void {
  try {
    localStorage.setItem(LOCAL_COURSES_KEY, JSON.stringify(list));
  } catch {
    throw new Error("Browser storage is full. Delete an old exam or free up space before saving.");
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TEMPLATE_CHANGED_EVENT));
}
function commit(r: { list: SavedCourse[]; saved: SavedCourse } | { error: string }): SavedCourse {
  if ("error" in r) throw new Error(r.error);
  write(r.list);
  return r.saved;
}

export const listLocalCourses = (): SavedCourse[] => [...read()].sort((a, b) => b.createdAt - a.createdAt);
export const getLocalCourse = (id: string): SavedCourse | null => read().find((c) => c.id === id) ?? null;

export const createLocalCourse = (input: CourseInput): SavedCourse => commit(createCourse(read(), input, { now: Date.now(), newId }));
export const updateLocalCourse = (id: string, fields: CourseFields): SavedCourse => commit(updateCourse(read(), id, fields, Date.now()));
export const addLocalSection = (courseId: string, name: string): SavedCourse => commit(addSection(read(), courseId, name, { now: Date.now(), newId }));
export const setLocalSectionClass = (courseId: string, sectionId: string, classId: string | null): SavedCourse => commit(setSectionClass(read(), courseId, sectionId, classId, Date.now()));
export const removeLocalSection = (courseId: string, sectionId: string): SavedCourse => commit(removeSection(read(), courseId, sectionId, countLocalCourseExams(courseId, sectionId), Date.now()));

/** Removes the course; its exams stay in the library, unfiled. */
export function deleteLocalCourse(id: string): void {
  write(removeCourse(read(), id));
  unassignLocalCourseExams(id);
}

// ---- which course the sheet being designed belongs to (designer → the moment it is saved)

export interface CourseBinding { templateId: string; courseId: string; sectionId: string | null }

export function readCourseBinding(): CourseBinding | null {
  try {
    const b = JSON.parse(localStorage.getItem(BINDING_KEY) ?? "null") as Partial<CourseBinding> | null;
    if (!b || typeof b.templateId !== "string" || typeof b.courseId !== "string") return null;
    return { templateId: b.templateId, courseId: b.courseId, sectionId: typeof b.sectionId === "string" ? b.sectionId : null };
  } catch { return null; }
}
export function writeCourseBinding(b: CourseBinding): void {
  try { localStorage.setItem(BINDING_KEY, JSON.stringify(b)); } catch { /* the exam is simply filed without a course */ }
}
export function clearCourseBinding(): void {
  try { localStorage.removeItem(BINDING_KEY); } catch { /* ignore */ }
}
