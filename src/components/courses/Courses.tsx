"use client";
/**
 * The dashboard's course panels: My Course (active-course spotlight), Sections (with bulk apply) and Course
 * Examinations. A course groups exams by subject and term; its sections are plain names (an exam covers
 * "All sections" unless one is chosen). The same components serve the cloud workspace and the on-device
 * library: they only receive data and actions.
 */
import Link from "next/link";
import { useState } from "react";
import {
  ALL_SECTIONS_KEY, courseExamRows, examScopeLabel, examScopeOptions, filterExamsByScope, hasScopeChoice, parseSectionList, scopeOptionLabel, type CourseFields, type CourseInput, type SavedCourse,
} from "@/lib/courses/courses";
import { CourseArt, GlyphIcon } from "@/components/dashboard/icons";
import Select from "@/components/ui/Select";
import type { DashboardRow } from "@/lib/dashboard";
import { SEMESTER_OPTIONS } from "@/lib/storage/exam-library";
import ActionMenu, { type MenuItem } from "./ActionMenu";

export interface BulkApplyInput {
  courseId: string;
  sectionIds: string[];
  baseName: string;
  sourceExamId?: string | null;
  useDeviceSheet?: boolean;
}
export interface CourseActions {
  canManage: boolean;
  onCreate: (input: CourseInput) => void | Promise<void>;
  onUpdate: (courseId: string, fields: CourseFields) => void | Promise<void>;
  onDelete: (courseId: string) => void | Promise<void>;
  onAddSection: (courseId: string, name: string) => void | Promise<void>;
  onRemoveSection: (courseId: string, sectionId: string) => void | Promise<void>;
  onSetSectionClass: (courseId: string, sectionId: string, classId: string | null) => void | Promise<void>;
  onBulkApply?: (input: BulkApplyInput) => void | Promise<void>;
}
export interface CourseExamActions {
  canManage: boolean;
  onOpen: (r: DashboardRow) => void;
  onCopy: (r: DashboardRow) => void | Promise<void>;
  onArchive: (r: DashboardRow, archived: boolean) => void | Promise<void>;
  onDelete: (r: DashboardRow) => void | Promise<void>;
  /** make the exam the active one and go scan its sheets */
  onScan?: (r: DashboardRow) => void;
  /** generate and download a PDF printout straight from the exam's saved sheet design */
  onPrint?: (r: DashboardRow) => void | Promise<void>;
}
export interface ClassOption { id: string; label: string; count: number }

const primary = "v-btn v-btn-primary border-[var(--brand-solid)] bg-[var(--brand-solid)] text-white hover:border-[var(--brand-solid-hover)] hover:bg-[var(--brand-solid-hover)] [@media(pointer:coarse)]:min-h-11";
const small = "v-btn min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11";
const codePill = "inline-block max-w-full truncate rounded-md bg-[var(--brand-solid)] px-2 py-0.5 text-xs font-bold text-white";
/** gold tint with text dark enough for 4.5:1 in light mode */
const scopePill = "inline-block rounded-full bg-[var(--gold-tint)] px-2.5 py-0.5 text-xs font-semibold text-[color-mix(in_srgb,var(--gold-hover)_45%,black)] dark:text-[var(--gold)]";
const allPill = "inline-block rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-xs font-semibold text-[var(--fg)]";

const term = (c: Pick<CourseFields, "semester" | "schoolYear">) => [c.semester, c.schoolYear].filter(Boolean).join(" · ");
const messageOf = (e: unknown) => (e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? String(e);
const fmtDate = (t: number | null) => (t === null ? "–" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
export const designHref = (courseId: string, sectionId?: string | null) => `/designer?courseId=${encodeURIComponent(courseId)}${sectionId ? `&sectionId=${encodeURIComponent(sectionId)}` : ""}`;

/** Runs an action, reporting the user-facing message of whatever it throws. */
function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, fn: () => void | Promise<void>): Promise<boolean> => {
    setBusy(key); setErr(null);
    try { await fn(); return true; } catch (e) { setErr(messageOf(e)); return false; } finally { setBusy(null); }
  };
  return { busy, err, setErr, run };
}

// ---------------------------------------------------------------- course form (create + edit)

function CourseForm({ initial, onSubmit, onCancel, submitLabel, withSections }: {
  initial?: CourseFields; onSubmit: (v: CourseInput) => Promise<boolean>; onCancel: () => void; submitLabel: string; withSections: boolean;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [semester, setSemester] = useState(initial?.semester ?? SEMESTER_OPTIONS[0]);
  const [schoolYear, setSchoolYear] = useState(initial ? initial.schoolYear ?? "" : "2026-2027");
  const [sections, setSections] = useState("");
  const [pending, setPending] = useState(false);
  const field = "block space-y-1 text-xs font-medium text-zinc-600 dark:text-zinc-400";
  const semesters = (SEMESTER_OPTIONS as readonly string[]).includes(semester) ? [...SEMESTER_OPTIONS] : [semester, ...SEMESTER_OPTIONS];
  return (
    <form data-testid="course-form" className="grid gap-3 border-b border-[var(--border)] bg-[var(--bg)] p-4 sm:grid-cols-2 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        await onSubmit({ code, title, semester, schoolYear: schoolYear.trim() || undefined, ...(withSections ? { sections: parseSectionList(sections) } : {}) });
        setPending(false);
      }}>
      <label className={field}>Course Code
        <input name="courseCode" data-testid="course-code" className="v-input w-full text-sm [@media(pointer:coarse)]:min-h-11" placeholder="e.g. HM 5" maxLength={40} required value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label className={field}>Course Title
        <input name="courseTitle" data-testid="course-title" className="v-input w-full text-sm [@media(pointer:coarse)]:min-h-11" placeholder="e.g. Applied Business Tools and Technologies" maxLength={200} required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={field}>Semester
        <Select
          name="courseSemester"
          dataTestId="course-semester"
          ariaLabel="Semester"
          value={semester}
          options={semesters.map((s) => ({ value: s, label: s }))}
          onChange={setSemester}
        />
      </label>
      <label className={field}>School Year
        <input name="courseYear" data-testid="course-year" className="v-input w-full text-sm [@media(pointer:coarse)]:min-h-11" placeholder="2026-2027" maxLength={80} value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} />
      </label>
      {withSections && (
        <label className={`${field} sm:col-span-2`}>Sections <span className="font-normal">(separate with commas)</span>
          <input name="courseSections" data-testid="course-sections-input" className="v-input w-full text-sm [@media(pointer:coarse)]:min-h-11" placeholder="BS-HM 2A, BS-HM 2B, BS-HM 2C" value={sections} onChange={(e) => setSections(e.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} data-testid="course-submit" className={`${primary} min-h-9 px-4 text-sm`}>{submitLabel}</button>
        <button type="button" className={small} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- My Course (active-course spotlight)

export function CoursePanel({ courses, loaded, active, rows, actions, onSelect }: {
  courses: SavedCourse[]; loaded: boolean; active: SavedCourse | null; rows: DashboardRow[]; actions: CourseActions; onSelect: (courseId: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, err, setErr, run } = useRun();
  // switching course closes any open edit / delete prompt
  const activeId = active?.id ?? null;
  const [seenId, setSeenId] = useState(activeId);
  if (seenId !== activeId) { setSeenId(activeId); setEditing(false); setConfirmDelete(false); }

  const examCount = active ? courseExamRows(rows, active.id).filter((r) => !r.archivedAt).length : 0;
  const toggleCreate = () => { setCreating((v) => !v); setEditing(false); setErr(null); };

  return (
    <section aria-labelledby="courses-title" className="v-panel min-w-0 overflow-hidden" data-testid="my-courses">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-5 py-4 sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-tint)] text-[var(--brand)]"><GlyphIcon id="book" /></span>
        <h2 id="courses-title" className="text-base font-semibold">{courses.length > 1 ? "My Courses" : "My Course"}</h2>
        {courses.length > 1 && (
          <div role="group" aria-label="Choose a course" className="flex min-w-0 flex-wrap gap-1.5" data-testid="course-pills">
            {courses.map((c) => {
              const on = c.id === active?.id;
              return (
                <button key={c.id} type="button" data-testid="course-pill" aria-pressed={on} title={c.title} onClick={() => onSelect(c.id)}
                  className={`min-h-9 max-w-40 truncate rounded-full border px-3 text-xs font-semibold transition-colors [@media(pointer:coarse)]:min-h-11 ${on ? "border-[var(--brand-solid)] bg-[var(--brand-solid)] text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:border-[var(--brand-soft)] hover:bg-[var(--brand-tint)]"}`}>
                  {c.code}
                </button>
              );
            })}
          </div>
        )}
        {actions.canManage && (
          <button type="button" data-testid="create-course-btn" aria-expanded={creating} className={`${primary} ml-auto min-h-9 px-3 text-sm`} onClick={toggleCreate}>+ Add Course</button>
        )}
      </div>

      {creating && (
        <CourseForm submitLabel="Create Course" withSections onCancel={() => setCreating(false)}
          onSubmit={async (v) => { const ok = await run("create", () => actions.onCreate(v)); if (ok) setCreating(false); return ok; }} />
      )}
      {editing && active && (
        <CourseForm initial={active} submitLabel="Save changes" withSections={false} onCancel={() => setEditing(false)}
          onSubmit={async (v) => { const ok = await run("update", () => actions.onUpdate(active.id, { code: v.code, title: v.title, semester: v.semester, schoolYear: v.schoolYear, ...(active.syllabusId ? { syllabusId: active.syllabusId } : {}) })); if (ok) setEditing(false); return ok; }} />
      )}
      {err && <p role="alert" className="px-6 pt-4 text-xs text-red-700 dark:text-red-300" data-testid="courses-error">{err}</p>}
      {busy === "create" && <p className="sr-only" role="status">Creating course…</p>}

      {!active ? (
        !loaded ? (
          <p role="status" className="p-6 text-sm text-zinc-500">Loading courses…</p>
        ) : (
          <div className="grid justify-items-start gap-3 p-6" data-testid="courses-empty">
            <p className="text-base font-semibold">No courses yet</p>
            <p className="text-sm text-zinc-500">{actions.canManage ? "Add a course to file exams under it and see them by section." : "Courses created by faculty will appear here."}</p>
            {actions.canManage && <button type="button" data-testid="courses-empty-add" className={`${primary} min-h-9 px-3 text-sm`} onClick={toggleCreate}>+ Add Course</button>}
          </div>
        )
      ) : (
        <div className="p-4 sm:p-6">
          <div data-testid="course-card" className="rounded-xl border border-[var(--border)] bg-[linear-gradient(135deg,var(--surface)_58%,var(--gold-tint))] p-5 dark:bg-[var(--surface)] sm:p-6">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <span className={codePill} data-testid="detail-code">{active.code}</span>
                <h3 className="mt-2 break-words text-xl font-bold leading-snug" data-testid="detail-title">{active.title}</h3>
                <p className="mt-1 text-sm text-zinc-500" data-testid="detail-term">{term(active)}</p>
                <p className="mt-1 text-xs text-zinc-500" data-testid="course-exam-count">{examCount} {examCount === 1 ? "exam" : "exams"} · {active.sections.length} {active.sections.length === 1 ? "section" : "sections"}</p>
                {actions.canManage && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button type="button" data-testid="edit-course" className={small} aria-expanded={editing} onClick={() => { setEditing((v) => !v); setCreating(false); }}>Edit Course</button>
                    {confirmDelete ? (
                      <span className="inline-flex flex-wrap items-center gap-2" data-testid="delete-course-confirm">
                        <span className="text-xs text-zinc-500">Its {examCount} {examCount === 1 ? "exam stays" : "exams stay"} in your library, unfiled.</span>
                        <button type="button" disabled={busy === "delete"} data-testid="confirm-delete-course" className="min-h-9 rounded-lg bg-red-700 px-3 text-xs font-medium text-white hover:bg-red-800 [@media(pointer:coarse)]:min-h-11"
                          onClick={async () => { await run("delete", () => actions.onDelete(active.id)); }}>Delete course</button>
                        <button type="button" className={small} onClick={() => setConfirmDelete(false)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" data-testid="delete-course" className="min-h-9 rounded-lg border border-red-300 px-3 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40 [@media(pointer:coarse)]:min-h-11"
                        onClick={() => setConfirmDelete(true)}>Delete</button>
                    )}
                  </div>
                )}
              </div>
              <CourseArt className="hidden h-28 w-auto shrink-0 sm:block" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Sections (with bulk apply)

interface DesignSourceOption {
  key: string;
  label: string;
  defaultName: string;
  sourceExamId?: string | null;
  useDeviceSheet?: boolean;
}

export function SectionsPanel({ course, rows, allRows = rows, deviceSheet = null, classes, actions }: {
  course: SavedCourse | null; rows: DashboardRow[]; allRows?: DashboardRow[]; deviceSheet?: { title: string; templateId?: string } | null; classes: ClassOption[]; actions: CourseActions;
}) {
  const [newSection, setNewSection] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSource, setBulkSource] = useState<string>("");
  const [bulkName, setBulkName] = useState<string>("");
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const { busy, err, run } = useRun();

  const sections = course?.sections ?? [];
  const exams = course ? courseExamRows(rows, course.id) : [];
  const classById = new Map(classes.map((c) => [c.id, c]));
  const scopedCount = (sectionId: string) => exams.filter((r) => !r.archivedAt && r.sectionId === sectionId).length;
  const bulk = actions.canManage && !!actions.onBulkApply;

  const validSelected = selectedIds.filter((id) => sections.some((s) => s.id === id));
  const allChecked = sections.length > 0 && validSelected.length === sections.length;
  const toggleAllSections = () => { setBulkStatus(null); setSelectedIds(allChecked ? [] : sections.map((s) => s.id)); };
  const toggleSection = (id: string) => { setBulkStatus(null); setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])); };

  const sources: DesignSourceOption[] = [];
  if (course) {
    for (const r of allRows) {
      const id = r.examId ?? r.localId;
      if (r.archivedAt || !id || r.courseId !== course.id) continue;
      sources.push({ key: `exam:${id}`, label: `${r.name} (${examScopeLabel(course, r.sectionId)})`, defaultName: r.name, sourceExamId: id });
    }
    if (deviceSheet) {
      const sheetTitle = deviceSheet.title.trim() || deviceSheet.templateId || "Untitled sheet";
      sources.push({ key: "device", label: `Current sheet on device: ${sheetTitle}`, defaultName: sheetTitle, useDeviceSheet: true });
    }
    for (const r of allRows) {
      const id = r.examId ?? r.localId;
      if (r.archivedAt || !id || r.courseId === course.id) continue;
      sources.push({ key: `exam:${id}`, label: `Library: ${r.name}`, defaultName: r.name, sourceExamId: id });
    }
  }
  const activeSource = sources.find((s) => s.key === bulkSource) ?? sources[0] ?? null;
  const effectiveBaseName = bulkName || activeSource?.defaultName || (course ? `${course.code} Examination` : "");

  return (
    <section aria-labelledby="sections-title" className="v-panel min-w-0 overflow-hidden" data-testid="course-sections">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-5 py-4 sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-tint)] text-[var(--brand)]"><GlyphIcon id="users" /></span>
        <h2 id="sections-title" className="text-base font-semibold">Sections</h2>
        {bulk && sections.length > 0 && (
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 [@media(pointer:coarse)]:min-h-11">
            <input type="checkbox" data-testid="select-all-sections" checked={allChecked} onChange={toggleAllSections} className="size-4 accent-[var(--brand-solid)]" />
            Select all
          </label>
        )}
        {validSelected.length > 0 && <span className={`${scopePill} ml-auto`} data-testid="selected-sections-count">{validSelected.length} selected</span>}
      </div>

      {err && <p role="alert" className="px-6 pt-3 text-xs text-red-700 dark:text-red-300" data-testid="course-error">{err}</p>}

      {course && bulk && validSelected.length > 0 && (
        <div data-testid="bulk-apply-bar" className="space-y-3 border-b border-[var(--border)] bg-[var(--gold-tint)] px-5 py-4 sm:px-6">
          {!activeSource ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <p className="font-medium">No exam design is ready yet. Design an answer sheet first, then apply it across your selected sections.</p>
              <Link href={designHref(course.id, null)} className={`${primary} min-h-9 px-3 text-xs`}>+ Design Exam</Link>
            </div>
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBulkStatus(null);
                const count = validSelected.length;
                const targetName = effectiveBaseName.trim() || activeSource.defaultName;
                const ok = await run("bulk-apply", () =>
                  actions.onBulkApply!({
                    courseId: course.id,
                    sectionIds: validSelected,
                    baseName: targetName,
                    ...(activeSource.sourceExamId ? { sourceExamId: activeSource.sourceExamId } : {}),
                    ...(activeSource.useDeviceSheet ? { useDeviceSheet: true } : {}),
                  }),
                );
                if (ok) {
                  setSelectedIds([]);
                  setBulkName("");
                  setBulkStatus(`Applied "${targetName}" to ${count} ${count === 1 ? "section" : "sections"}.`);
                }
              }}
            >
              <label className="block min-w-0 flex-1 basis-48 space-y-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Design to apply
                <Select
                  dataTestId="bulk-apply-source"
                  ariaLabel="Design to apply"
                  size="sm"
                  value={activeSource.key}
                  options={sources.map((s) => ({ value: s.key, label: s.label }))}
                  onChange={(nextKey) => {
                    setBulkSource(nextKey);
                    const picked = sources.find((s) => s.key === nextKey);
                    if (picked) setBulkName(picked.defaultName);
                  }}
                />
              </label>
              <label className="block min-w-0 flex-1 basis-40 space-y-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Exam title prefix
                <input type="text" data-testid="bulk-apply-name" maxLength={160} placeholder={activeSource.defaultName} value={bulkName} onChange={(e) => setBulkName(e.target.value)}
                  className="v-input w-full text-xs [@media(pointer:coarse)]:min-h-11" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" data-testid="bulk-apply-submit" disabled={busy === "bulk-apply"} className={`${primary} min-h-9 px-3 text-xs`}>
                  {busy === "bulk-apply" ? "Applying…" : `Apply Design to ${validSelected.length} ${validSelected.length === 1 ? "Section" : "Sections"}`}
                </button>
                <button type="button" className={small} onClick={() => setSelectedIds([])}>Clear</button>
              </div>
            </form>
          )}
        </div>
      )}

      {bulkStatus && (
        <p role="status" data-testid="bulk-apply-status" className="border-b border-[var(--border)] bg-emerald-500/10 px-6 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">{bulkStatus}</p>
      )}

      {!course ? (
        <p className="p-6 text-sm text-zinc-500" data-testid="sections-empty">Add a course first, then list its sections here.</p>
      ) : sections.length === 0 ? (
        <p className="p-6 text-sm text-zinc-500" data-testid="sections-empty">No sections yet. An exam designed now covers the whole course.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {sections.map((s) => {
            const linked = s.classId ? classById.get(s.classId) : undefined;
            const n = scopedCount(s.id);
            const menu: MenuItem[] = [{ key: "remove", label: "Remove section", testId: "remove-section", danger: true, disabled: busy === `rm:${s.id}`, onSelect: () => void run(`rm:${s.id}`, () => actions.onRemoveSection(course.id, s.id)) }];
            return (
              <li key={s.id} data-testid="section-row" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
                <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
                  {bulk && (
                    <label className="inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11">
                      <input type="checkbox" aria-label={`Select ${s.name}`} data-testid="section-select-checkbox" checked={validSelected.includes(s.id)} onChange={() => toggleSection(s.id)} className="size-4 accent-[var(--brand-solid)]" />
                    </label>
                  )}
                  <div className="min-w-0">
                    <span className="block break-words font-medium">{s.name}</span>
                    <span className="block text-xs text-zinc-500">{n} {n === 1 ? "exam" : "exams"}{linked ? ` · roster: ${linked.count} students` : ""}</span>
                  </div>
                </div>
                {actions.canManage && (
                  <div className="flex items-center gap-2">
                    <Select
                      ariaLabel={`Class roster for ${s.name}`}
                      dataTestId="section-class-select"
                      size="sm"
                      className="w-40"
                      disabled={busy === `cls:${s.id}`}
                      value={s.classId && classById.has(s.classId) ? s.classId : ""}
                      options={[
                        { value: "", label: "No roster attached" },
                        ...classes.map((c) => ({ value: c.id, label: `${c.label} (${c.count})` })),
                      ]}
                      onChange={(v) => void run(`cls:${s.id}`, () => actions.onSetSectionClass(course.id, s.id, v || null))}
                    />
                    <Link href={designHref(course.id, s.id)} data-testid="design-for-section" aria-label={`Design exam for ${s.name}`} className={`${small} whitespace-nowrap`}>Design Exam</Link>
                    <ActionMenu label={`More actions for ${s.name}`} testId="section-actions" items={menu} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {course && actions.canManage && (
        <form className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg)] px-5 py-4 sm:px-6"
          onSubmit={async (e) => { e.preventDefault(); if (await run("add", () => actions.onAddSection(course.id, newSection))) setNewSection(""); }}>
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2 sm:max-w-xs">
            <label className="block min-w-0 flex-1 basis-40 space-y-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">New section
              <input name="newSection" data-testid="new-section-input" className="v-input min-h-9 w-full text-sm [@media(pointer:coarse)]:min-h-11" placeholder="e.g. BS-HM 2D" maxLength={60} value={newSection} onChange={(e) => setNewSection(e.target.value)} />
            </label>
            <button type="submit" data-testid="add-section" disabled={busy === "add" || !newSection.trim()} className={`${small} whitespace-nowrap`}>+ Add Section</button>
          </div>
          <Link
            href="/grade?tab=roster"
            data-testid="import-roster-btn"
            className={`${small} gap-1.5 whitespace-nowrap border-[var(--brand-soft)] bg-[var(--brand-tint)] text-[var(--brand-text-on-tint)] hover:border-[var(--brand)]`}
          >
            <GlyphIcon id="upload" className="size-4" />
            Import a class roster
          </Link>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Course Examinations

const PREVIEW_ROWS = 6;

export function CourseExamsPanel({ course, rows, canDesign, exam, allShown, onToggleAll }: {
  course: SavedCourse | null; rows: DashboardRow[]; canDesign: boolean; exam: CourseExamActions; allShown: boolean; onToggleAll: () => void;
}) {
  const { busy, err, run } = useRun();
  const [scope, setScope] = useState("");   // "" = All; the panel is keyed by course, so it starts over when the course changes
  const exams = course ? courseExamRows(rows, course.id) : [];
  const options = course ? examScopeOptions(course, exams) : [];
  const showFilter = !!course && hasScopeChoice(course, exams);
  // a scope that has gone (section removed, filter no longer worth showing) falls back to All
  const activeScope = showFilter && options.some((o) => o.key === scope) ? scope : "";
  // filter first, then take the latest PREVIEW_ROWS, so one section's newest exams show without View All
  const filtered = course ? filterExamsByScope(course, exams, activeScope) : [];
  const shown = filtered.slice(0, PREVIEW_ROWS);
  const scopeName = course ? scopeOptionLabel(course, activeScope) : "All";

  return (
    <section aria-labelledby="course-exams-title" className="v-panel min-w-0 overflow-hidden" data-testid="course-exams">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-5 py-4 sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-tint)] text-[var(--brand)]"><GlyphIcon id="doc" /></span>
        <h2 id="course-exams-title" className="text-base font-semibold">Course Examinations</h2>
        <button type="button" data-testid="view-all-exams-btn" aria-expanded={allShown} aria-controls="all-exams" onClick={onToggleAll}
          className={`${primary} ml-auto min-h-9 px-3 text-sm`}>
          {allShown ? "Hide All ↑" : "View All →"}
        </button>
      </div>
      {err && <p role="alert" className="px-6 pt-3 text-xs text-red-700 dark:text-red-300" data-testid="exam-error">{err}</p>}

      {!course ? (
        <p className="p-6 text-sm text-zinc-500" data-testid="course-exams-empty">Add a course and its examinations will be listed here.</p>
      ) : exams.length === 0 ? (
        <div className="grid justify-items-start gap-3 p-6 text-sm text-zinc-500" data-testid="course-exams-empty">
          <p>No exams in {course.code} yet.</p>
          {canDesign && <Link href={designHref(course.id)} className={`${primary} min-h-9 px-3 text-xs`}>+ Design Exam</Link>}
        </div>
      ) : (
        <>
          {showFilter && (
            <div role="group" aria-label="Filter examinations by section" data-testid="course-exam-filter" className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-5 py-3 sm:px-6">
              {options.map((o) => {
                const on = o.key === activeScope;
                return (
                  <button key={o.key || "all"} type="button" data-testid="course-exam-filter-pill" aria-pressed={on} title={o.label} onClick={() => setScope(o.key)}
                    className={`min-h-9 max-w-48 truncate rounded-full border px-3 text-xs font-semibold transition-colors [@media(pointer:coarse)]:min-h-11 ${on ? "border-[var(--brand-solid)] bg-[var(--brand-solid)] text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:border-[var(--brand-soft)] hover:bg-[var(--brand-tint)]"}`}>
                    {o.label} ({o.count})
                  </button>
                );
              })}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="grid justify-items-start gap-3 p-6 text-sm text-zinc-500" data-testid="course-exams-filter-empty">
              <p role="status">{activeScope === ALL_SECTIONS_KEY ? "No exams cover all sections yet." : `No exams scoped to ${scopeName} yet.`}</p>
              {canDesign && <Link href={designHref(course.id, activeScope && activeScope !== ALL_SECTIONS_KEY ? activeScope : null)} className={`${primary} min-h-9 px-3 text-xs`}>+ Design Exam</Link>}
            </div>
          ) : (<>
          <table className="v-table w-full">
            <caption className="sr-only">Examinations in {course.code}</caption>
            <thead><tr>
              <th scope="col" className="px-4 py-2 sm:px-6">Exam</th>
              <th scope="col" className="px-2 py-2">Scope</th>
              <th scope="col" className="px-2 py-2">Status</th>
              <th scope="col" className="hidden px-2 py-2 sm:table-cell">Created</th>
              <th scope="col" className="w-12 px-2 py-2 sm:pr-4"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const label = examScopeLabel(course, r.sectionId);
                const items: MenuItem[] = [{ key: "open", label: "Open Gradebook", testId: "exam-open", onSelect: () => exam.onOpen(r) }];
                if (exam.onScan) items.push({ key: "scan", label: "Scan Sheets", testId: "exam-scan", onSelect: () => exam.onScan!(r) });
                if (exam.onPrint) items.push({ key: "print", label: "Print Sheet PDF", testId: "exam-print", disabled: busy === r.key, onSelect: () => void run(r.key, () => exam.onPrint!(r)) });
                if (exam.canManage) {
                  items.push(
                    { key: "copy", label: "Copy", testId: "exam-copy", disabled: busy === r.key, onSelect: () => void run(r.key, () => exam.onCopy(r)) },
                    { key: "archive", label: r.archivedAt ? "Restore" : "Archive", testId: "exam-archive", disabled: busy === r.key, onSelect: () => void run(r.key, () => exam.onArchive(r, !r.archivedAt)) },
                    { key: "delete", label: "Delete", testId: "exam-delete", danger: true, disabled: busy === r.key, confirm: { text: `Delete “${r.name}”?`, action: "Delete", testId: "confirm-delete-exam" }, onSelect: () => void run(r.key, () => exam.onDelete(r)) },
                  );
                }
                return (
                  <tr key={r.key} data-testid="course-exam-row">
                    <td className="min-w-0 px-4 py-3 sm:px-6">
                      <button type="button" data-testid="course-exam-open" onClick={() => exam.onOpen(r)} title="Open in the Gradebook"
                        className="block max-w-full break-words rounded text-left font-medium underline-offset-2 hover:underline [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-2">{r.name}</button>
                      <span className="block text-xs text-zinc-500">{r.where}{r.period ? ` · ${r.period}` : ""}<span className="sm:hidden"> · {fmtDate(r.createdAt)}</span></span>
                    </td>
                    <td className="px-2 py-3"><span className={label === "All sections" ? allPill : scopePill} data-testid="exam-scope-pill">{label}</span></td>
                    <td className="px-2 py-3"><span className={`v-badge ${r.status === "Open" ? "v-badge-ok" : ""}`}>{r.status}</span></td>
                    <td className="hidden px-2 py-3 text-zinc-500 sm:table-cell">{fmtDate(r.createdAt)}</td>
                    <td className="px-2 py-2 text-right sm:pr-4"><ActionMenu label={`Actions for ${r.name}`} testId="exam-actions" items={items} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > shown.length && (
            <p className="border-t border-[var(--border)] px-6 py-3 text-xs text-zinc-500" data-testid="course-exams-more">Showing the latest {shown.length} of {filtered.length}{activeScope ? ` for ${scopeName}` : ""}. Use View All for the rest.</p>
          )}
          </>)}
        </>
      )}
    </section>
  );
}
