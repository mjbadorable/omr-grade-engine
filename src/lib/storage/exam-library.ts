/**
 * Local-first exam library and semester folder store (localStorage).
 * Lets teachers copy set-up exams, organize them into stored semester folders,
 * archive/restore them, and delete them even without a Convex cloud connection.
 */
import type { DashboardRow } from "@/lib/dashboard";
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
  writeJson(LOCAL_FOLDERS_KEY, [folder, ...existing]);
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

export function listLocalExams(): LocalExamRecord[] {
  const list = readJson<LocalExamRecord[]>(LOCAL_EXAMS_KEY, []);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export function upsertLocalExam(
  template: OMRTemplate,
  opts: { name?: string; folderId?: string | null } = {},
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
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const key = readStoredKey(src.template.layoutHash);
  if (key) writeStoredKey(clonedTemplate.layoutHash, key);
  writeJson(LOCAL_EXAMS_KEY, [copy, ...exams]);
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

