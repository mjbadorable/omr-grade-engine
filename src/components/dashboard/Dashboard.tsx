"use client";
/**
 * Teacher Dashboard, a three-row bento: the At a Glance KPI strip; My Course (with its switcher) beside Quick
 * Actions; and the active course's Sections (bulk apply) beside its Examinations. "View All" opens the full
 * library with semester folders, copy, archive and delete. Every number comes from this device
 * (saved sheet + IndexedDB scans) or the workspace's real queries; unknown values show "–"
 * and an empty account gets an empty state, never sample rows.
 */
import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BrandMark } from "@/components/brand/Brand";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { type ClassOption, type CourseActions, CoursePanel, CourseExamsPanel, designHref, SectionsPanel } from "@/components/courses/Courses";
import { useCourseRoute } from "@/components/courses/useCourseRoute";
import { useCourses } from "@/components/courses/useCourses";
import { useLocalClasses } from "@/components/grading/useLocalClasses";
import { GlyphIcon } from "@/components/dashboard/icons";
import Select from "@/components/ui/Select";
import { Icon } from "@/components/shell/Rail";
import { TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import { atAGlance, dashboardKpis, dashboardRows, firstName, greeting, type DashboardRow, type GlanceTile, type LocalLibraryExam, type LocalSheet, type WorkspaceExam } from "@/lib/dashboard";
import { classLabel } from "@/lib/classes/classes";
import type { SavedCourse } from "@/lib/courses/courses";
import { OMRTemplateSchema, type OMRTemplate } from "@/lib/omr/schema";
import { isAdmin } from "@/lib/roles/policy";
import {
  activateLocalExam,
  applyDesignToLocalSections,
  archiveLocalExam,
  assignLocalExamFolder,
  createLocalFolder,
  deleteLocalExam,
  deleteLocalFolder,
  duplicateLocalExam,
  filterDashboardRows,
  listLocalExams,
  listLocalFolders,
  SEMESTER_OPTIONS,
  upsertLocalExam,
} from "@/lib/storage/exam-library";
import { readStoredPlan } from "@/lib/syllabus/plan-store";
import {
  addLocalSection, createLocalCourse, deleteLocalCourse, listLocalCourses, readCourseBinding, removeLocalSection, setLocalSectionClass, updateLocalCourse,
} from "@/lib/storage/course-library";
import { countScans, listScans } from "@/lib/storage/scan-store";
import { readStoredTemplate } from "@/lib/storage/template-store";

export interface FolderOption {
  id: string;
  name: string;
  semester: string;
  schoolYear: string | null;
}

export interface ExamActions {
  canManage: boolean;
  onOpen: (r: DashboardRow) => void;
  onCopy: (r: DashboardRow) => void | Promise<void>;
  onArchive: (r: DashboardRow, archived: boolean) => void | Promise<void>;
  onDelete: (r: DashboardRow) => void | Promise<void>;
  /** activate the exam, then go scan its sheets */
  onScan?: (r: DashboardRow) => void;
  /** generate and download a PDF printout straight from the exam's stored template */
  onPrint?: (r: DashboardRow) => void | Promise<void>;
  onAssignFolder: (r: DashboardRow, folderId: string | null) => void | Promise<void>;
  onCreateFolder: (input: { name: string; semester: string; schoolYear?: string }) => void | Promise<void>;
  onDeleteFolder: (folderId: string) => void | Promise<void>;
}

const fmtDate = (t: number | null) => (t === null ? "–" : new Date(t).toLocaleDateString(undefined, { dateStyle: "medium" }));
const num = (n: number | null) => (n === null ? "–" : String(n));

async function downloadExamPdf(template: OMRTemplate | null | undefined, fallbackName = "exam-sheet") {
  if (!template) throw new Error("Saved sheet design could not be loaded for this exam.");
  const { generatePdf } = await import("@/lib/omr/pdf-generator");
  const bytes = await generatePdf(template);
  const safeName = (template.templateId || fallbackName).replace(/[^A-Za-z0-9_-]+/g, "-");
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${safeName}-v${template.version}.pdf` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The sheet & local library saved on this device, kept current when the designer changes it. */
function useDeviceSheet() {
  const [local, setLocal] = useState<LocalSheet | null>(null);
  const [localExams, setLocalExams] = useState<LocalLibraryExam[]>([]);
  const [localFolders, setLocalFolders] = useState<FolderOption[]>([]);
  const [layoutScans, setLayoutScans] = useState<number | null>(null);
  const [totalScans, setTotalScans] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      const t = readStoredTemplate();
      if (t && !listLocalExams().some((e) => e.template.layoutHash === t.layoutHash)) {
        // a sheet designed inside a course is filed there (only while that course still exists)
        const b = readCourseBinding();
        const filed = b && b.templateId === t.templateId && listLocalCourses().some((c) => c.id === b.courseId) ? { courseId: b.courseId, sectionId: b.sectionId } : {};
        upsertLocalExam(t, filed);
      }
      setLocal(t ? { title: t.title, layoutHash: t.layoutHash, templateId: t.templateId } : null);
      setLocalExams(
        listLocalExams().map((e) => ({
          id: e.id,
          name: e.name,
          layoutHash: e.template.layoutHash,
          folderId: e.folderId,
          archivedAt: e.archivedAt,
          createdAt: e.createdAt,
          courseId: e.courseId ?? null,
          sectionId: e.sectionId ?? null,
        })),
      );
      setLocalFolders(
        listLocalFolders().map((f) => ({
          id: f.id,
          name: f.name,
          semester: f.semester,
          schoolYear: f.schoolYear,
        })),
      );
      if (t) listScans(t.layoutHash).then((x) => live && setLayoutScans(x.length)).catch(() => live && setLayoutScans(null));
      else setLayoutScans(0);
      countScans().then((n) => live && setTotalScans(n)).catch(() => live && setTotalScans(null));
    };
    read();
    window.addEventListener(TEMPLATE_CHANGED_EVENT, read);
    return () => { live = false; window.removeEventListener(TEMPLATE_CHANGED_EVENT, read); };
  }, []);

  return { local, localExams, localFolders, layoutScans, totalScans };
}

function Kpi({ id, label, value, icon, title }: { id: string; label: string; value: string; icon: React.ReactNode; title?: string }) {
  return (
    <div role="group" aria-label={`${label}: ${value}`} title={title} className="v-panel flex min-w-0 items-center gap-3 p-3 sm:p-4" data-testid={`glance-${id}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand)] sm:size-11">{icon}</span>
      <div className="min-w-0">
        <p className="v-mono text-2xl font-bold leading-none" data-testid={`glance-${id}-value`}>{value}</p>
        <p className="mt-1 break-words text-xs text-zinc-500 sm:text-sm">{label}</p>
      </div>
    </div>
  );
}

function DashboardView({
  name,
  rows,
  deviceSheet,
  folders,
  glance,
  actions,
  courses,
  coursesLoaded,
  courseActions,
  classes,
}: {
  name: string | null;
  rows: DashboardRow[];
  deviceSheet?: LocalSheet | null;
  folders: FolderOption[];
  glance: GlanceTile[];
  actions: ExamActions;
  courses: SavedCourse[];
  coursesLoaded: boolean;
  courseActions: CourseActions;
  classes: ClassOption[];
}) {
  const [hour, setHour] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>("all");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [semester, setSemester] = useState<string>(SEMESTER_OPTIONS[0]);
  const [schoolYear, setSchoolYear] = useState("2026-2027");
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // null = automatic: the full library shows by itself while there is no course to list exams for
  const [viewAll, setViewAll] = useState<boolean | null>(null);
  const route = useCourseRoute();
  const routed = route.courseId ? courses.find((c) => c.id === route.courseId) ?? null : null;
  // the course in view: the one in ?courseId=, else the first (nothing is written to the URL until the teacher picks one)
  const course = routed ?? courses[0] ?? null;
  const [courseGone, setCourseGone] = useState(false);
  const seenCourses = useRef(new Set<string>());

  useEffect(() => { setHour(new Date().getHours()); }, []);
  useEffect(() => { for (const c of courses) seenCourses.current.add(c.id); }, [courses]);
  // a bookmarked ?courseId= that is not one of this teacher's courses: say so (unless it was just deleted here) and show the first course
  const missingCourse = !!route.courseId && coursesLoaded && !routed;
  const closeCourse = route.close;
  useEffect(() => {
    if (!missingCourse || !route.courseId) return;
    if (!seenCourses.current.has(route.courseId)) setCourseGone(true);
    closeCourse(true);
  }, [missingCourse, route.courseId, closeCourse]);

  const allShown = viewAll ?? !course;
  const visibleRows = filterDashboardRows(rows, { showArchived, folderId: selectedFolder });
  const activeCount = rows.filter((r) => !r.archivedAt).length;
  const archivedCount = rows.filter((r) => !!r.archivedAt).length;
  const folderById = new Map(folders.map((f) => [f.id, f]));

  const runAction = async (key: string, fn: () => void | Promise<void>) => {
    setBusyKey(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) { setErr("Folder name is required."); return; }
    await runAction("new-folder", async () => {
      await actions.onCreateFolder({ name: folderName.trim(), semester, schoolYear: schoolYear.trim() || undefined });
      setFolderName("");
      setCreatingFolder(false);
    });
  };

  const toggleAll = () => {
    const next = !allShown;
    setViewAll(next);
    if (next) setTimeout(() => document.getElementById("recent-title")?.focus(), 0);
  };

  // KPI strip: real counts only; "–" while a value is not known yet
  const ICONS = { courses: <GlyphIcon id="book" />, sections: <GlyphIcon id="users" />, exams: <GlyphIcon id="doc" />, scanned: <GlyphIcon id="check" /> };
  const kpis = dashboardKpis({ courses, coursesLoaded, glance });
  const syllabi = glance.find((t) => t.id === "syllabi" && t.available);
  const pending = glance.find((t) => t.id === "pending" && t.available);

  const designUrl = course ? designHref(course.id) : "/designer";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6" data-testid="dashboard">
      <header>
        <h1 className="text-2xl font-bold" data-testid="dashboard-greeting">{hour === null ? "Welcome" : greeting(hour)}{name ? `, ${name}` : ""}</h1>
        <p className="mt-2 text-sm text-zinc-500">Manage your courses, sections, and examinations.</p>
      </header>

      <div className="space-y-2">
        <section aria-label="At a glance" className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="at-a-glance">
          {kpis.map((k) => <Kpi key={k.id} id={k.id} label={k.label} value={num(k.value)} icon={ICONS[k.id]} title={k.id === "scanned" ? "Sheets scanned on this device" : undefined} />)}
        </section>
        {(syllabi || pending) && (
          <p className="text-xs text-zinc-500" data-testid="glance-workspace">
            Workspace:{" "}
            {syllabi && <span data-testid="glance-syllabi">{num(syllabi.value)} {syllabi.value === 1 ? "syllabus" : "syllabi"}</span>}
            {syllabi && pending && " · "}
            {pending && <Link href="/admin" className="underline underline-offset-2" data-testid="glance-pending">{num(pending.value)} pending access {pending.value === 1 ? "request" : "requests"}</Link>}
          </p>
        )}
      </div>

      {courseGone && <p role="status" className="v-panel px-4 py-3 text-sm" data-testid="course-missing">That course is not available. It may have been deleted.</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <CoursePanel courses={courses} loaded={coursesLoaded} active={course} rows={rows} actions={courseActions} onSelect={(id) => route.open(id, { scroll: false })} />

        <section aria-labelledby="qa-title" className="v-panel min-w-0 p-5 sm:p-6" data-testid="quick-actions">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-tint)] text-[var(--brand)]"><GlyphIcon id="bolt" /></span>
            <h2 id="qa-title" className="text-base font-semibold">Quick Actions</h2>
            <Link href="/grade?tab=analysis" data-testid="action-reports" className="v-btn v-btn-primary ml-auto min-h-9 border-[var(--brand-solid)] bg-[var(--brand-solid)] px-3 text-sm text-white hover:border-[var(--brand-solid-hover)] hover:bg-[var(--brand-solid-hover)] [@media(pointer:coarse)]:min-h-11">Reports →</Link>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { id: "design", label: "Design Exam", text: "Create a new exam for a section", href: designUrl, icon: <Icon id="design" />, primary: true },
              { id: "scan", label: "Scan & Upload", text: "Photograph or upload exam sheets", href: "/scan", icon: <Icon id="scan" />, primary: false },
              { id: "grade", label: "View Gradebook", text: "Check and manage student grades", href: "/grade", icon: <Icon id="reports" />, primary: false },
            ].map((a) => (
              <Link key={a.id} href={a.href} data-testid={`action-${a.id}`}
                className={`group flex min-h-16 flex-row items-center gap-3 rounded-xl border p-4 transition duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-col sm:items-start ${a.primary ? "border-[var(--brand-soft)] bg-[var(--brand-tint)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand-soft)]"}`}>
                <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${a.primary ? "bg-[var(--brand-solid)] text-white" : "bg-[var(--brand-tint)] text-[var(--brand)]"}`}>{a.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{a.label}</span>
                  <span className="mt-1 block text-xs text-zinc-500">{a.text}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionsPanel key={`s:${course?.id ?? ""}`} course={course} rows={rows} allRows={rows} deviceSheet={deviceSheet} classes={classes} actions={courseActions} />
        <CourseExamsPanel key={`e:${course?.id ?? ""}`} course={course} rows={rows} canDesign={courseActions.canManage} allShown={allShown} onToggleAll={toggleAll}
          exam={{ canManage: actions.canManage, onOpen: actions.onOpen, onCopy: actions.onCopy, onArchive: actions.onArchive, onDelete: actions.onDelete, onScan: actions.onScan, onPrint: actions.onPrint }} />
      </div>

      {allShown && (
        <section id="all-exams" aria-labelledby="recent-title" className="v-panel min-w-0 overflow-hidden" data-testid="recent-exams">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-6">
            <h2 id="recent-title" tabIndex={-1} className="text-base font-semibold !outline-none">All Examinations &amp; Semester Folders</h2>
            <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-900" role="tablist" aria-label="Exam status filter">
              <button type="button" role="tab" aria-selected={!showArchived} onClick={() => setShowArchived(false)}
                className={`rounded-md px-2.5 py-1 font-medium transition [@media(pointer:coarse)]:min-h-11 ${!showArchived ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                Active ({activeCount})
              </button>
              <button type="button" role="tab" aria-selected={showArchived} onClick={() => setShowArchived(true)}
                className={`rounded-md px-2.5 py-1 font-medium transition [@media(pointer:coarse)]:min-h-11 ${showArchived ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                Archived ({archivedCount})
              </button>
            </div>
            {rows.length > 0 && <Link href="/grade" className="ml-auto inline-flex min-h-9 items-center text-sm font-medium text-[var(--brand-text-on-tint)] hover:underline [@media(pointer:coarse)]:min-h-11">Open Gradebook</Link>}
          </div>

          {/* Semester Folder Bar */}
          <div className="space-y-3 border-b border-[var(--border)] bg-zinc-50/60 px-6 py-3 dark:bg-zinc-900/40" data-testid="semester-folders-bar">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-zinc-500">Semester Folder:</span>
              <button type="button" onClick={() => setSelectedFolder("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition [@media(pointer:coarse)]:min-h-11 ${selectedFolder === "all" ? "bg-[var(--brand-solid)] text-white" : "border border-[var(--border)] bg-white/80 text-zinc-600 hover:border-[var(--brand-soft)] dark:bg-zinc-900 dark:text-zinc-300"}`}>
                All
              </button>
              {folders.map((f) => {
                const count = rows.filter((r) => (showArchived ? !!r.archivedAt : !r.archivedAt) && r.folderId === f.id).length;
                const active = selectedFolder === f.id;
                return (
                  <span key={f.id} className={`inline-flex items-center gap-1 rounded-full pl-3 pr-1.5 py-1 text-xs [@media(pointer:coarse)]:min-h-11 font-medium transition ${active ? "bg-[var(--brand-solid)] text-white" : "border border-[var(--border)] bg-white/80 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
                    <button type="button" className="[@media(pointer:coarse)]:min-h-11" onClick={() => setSelectedFolder(f.id)} title={`${f.semester}${f.schoolYear ? ` · ${f.schoolYear}` : ""}`}>
                      {f.name} ({count})
                    </button>
                    {actions.canManage && (
                      <button type="button" aria-label={`Delete folder ${f.name}`}
                        onClick={() => runAction(`del-folder:${f.id}`, async () => {
                          await actions.onDeleteFolder(f.id);
                          if (selectedFolder === f.id) setSelectedFolder("all");
                        })}
                        className={`rounded-full px-1 leading-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 opacity-75 hover:opacity-100 ${active ? "hover:bg-white/20" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              <button type="button" onClick={() => setSelectedFolder("unfiled")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition [@media(pointer:coarse)]:min-h-11 ${selectedFolder === "unfiled" ? "bg-[var(--brand-solid)] text-white" : "border border-[var(--border)] bg-white/80 text-zinc-600 hover:border-[var(--brand-soft)] dark:bg-zinc-900 dark:text-zinc-300"}`}>
                Unfiled
              </button>
              {actions.canManage && (
                <button type="button" data-testid="new-folder-btn" onClick={() => { setCreatingFolder((v) => !v); setErr(null); }}
                  className="ml-auto rounded-full border border-dashed border-[var(--brand-soft)] px-3 py-1 text-xs [@media(pointer:coarse)]:min-h-11 font-medium text-[var(--brand-text-on-tint)] hover:bg-[var(--brand-tint)]">
                  + New Folder
                </button>
              )}
            </div>

            {creatingFolder && (
              <form onSubmit={handleCreateFolder} className="grid gap-2 rounded-xl border border-[var(--border)] bg-white p-3 sm:grid-cols-4 dark:bg-zinc-950" data-testid="new-folder-form">
                <input id="new-folder-name" name="folderName" type="text" placeholder="Folder name (e.g. 1st Sem 2026-2027)" value={folderName} onChange={(e) => setFolderName(e.target.value)}
                  className="v-input text-xs sm:col-span-2 [@media(pointer:coarse)]:min-h-11" aria-label="Folder name" required />
                <Select
                  id="new-folder-semester"
                  name="semester"
                  ariaLabel="Semester"
                  size="sm"
                  value={semester}
                  options={SEMESTER_OPTIONS.map((s) => ({ value: s, label: s }))}
                  onChange={setSemester}
                />
                <div className="flex gap-2">
                  <input id="new-folder-year" name="schoolYear" type="text" placeholder="School year" value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)}
                    className="v-input w-full text-xs [@media(pointer:coarse)]:min-h-11" aria-label="School year" />
                  <button type="submit" disabled={busyKey === "new-folder"} className="v-btn v-btn-primary shrink-0 !px-3 !py-1 text-xs [@media(pointer:coarse)]:min-h-11">
                    Save
                  </button>
                </div>
              </form>
            )}
            {err && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
          </div>

          {visibleRows.length === 0 ? (
            <div className="grid justify-items-center gap-4 p-8 text-center" data-testid="recent-empty">
              <BrandMark className="size-12" />
              <div>
                <p className="text-base font-semibold">{showArchived ? "No archived examinations" : rows.length === 0 ? "No examinations yet" : "No examinations in this folder"}</p>
                <p className="mt-2 text-sm text-zinc-500">
                  {showArchived
                    ? "Archived examinations appear here so you can restore or delete them."
                    : rows.length === 0
                      ? "Design your first answer sheet and it will show up here."
                      : "Assign an exam to this semester folder or switch back to All."}
                </p>
              </div>
              {rows.length === 0 && !showArchived && <Link href="/designer" className="v-btn v-btn-primary px-4">Design Exam</Link>}
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="v-table min-w-[660px]">
                <caption className="sr-only">Examinations</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-6 py-2">Exam</th>
                    <th scope="col" className="px-4 py-2">Folder</th>
                    <th scope="col" className="px-4 py-2">Status</th>
                    <th scope="col" className="px-4 py-2 text-right">Sheets</th>
                    <th scope="col" className="px-4 py-2">Created</th>
                    <th scope="col" className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const folder = r.folderId ? folderById.get(r.folderId) : null;
                    const busy = busyKey === r.key;
                    const confirmingDelete = confirmDeleteKey === r.key;
                    return (
                      <tr key={r.key} data-testid="recent-row">
                        <td className="px-6 py-4">
                          <span className="block font-medium">{r.name}</span>
                          <span className="block text-xs text-zinc-500">
                            {r.where}{r.period ? ` · ${r.period}` : ""}{folder ? ` · ${folder.semester}` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {actions.canManage ? (
                            <Select
                              id={`folder-${r.key}`}
                              name={`folder-${r.key}`}
                              ariaLabel={`Semester folder for ${r.name}`}
                              size="sm"
                              className="w-36 max-w-[160px]"
                              value={r.folderId ?? ""}
                              disabled={busy}
                              options={[
                                { value: "", label: "Unfiled" },
                                ...folders.map((f) => ({ value: f.id, label: f.name })),
                              ]}
                              onChange={(v) => runAction(r.key, () => actions.onAssignFolder(r, v || null))}
                            />
                          ) : (
                            <span className="text-xs text-zinc-500">{folder ? folder.name : "Unfiled"}</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`v-badge ${r.status === "Open" ? "v-badge-ok" : r.status === "Draft" ? "v-badge-gold !text-[color-mix(in_srgb,var(--gold-hover)_45%,black)] dark:!text-[var(--gold-hover)]" : ""}`}>{r.status}</span>
                        </td>
                        <td className="v-mono px-4 py-4 text-right">{num(r.scanned)}</td>
                        <td className="px-4 py-4 text-zinc-500">{fmtDate(r.createdAt)}</td>
                        <td className="px-4 py-4 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button type="button" className="v-btn !px-3 !py-1 text-xs [@media(pointer:coarse)]:min-h-11" onClick={() => actions.onOpen(r)}>Open</button>
                            {actions.canManage && (
                              <>
                                <button type="button" disabled={busy} className="v-btn !px-2.5 !py-1 text-xs [@media(pointer:coarse)]:min-h-11"
                                  onClick={() => runAction(r.key, () => actions.onCopy(r))} title="Copy set-up exam">
                                  Copy
                                </button>
                                <button type="button" disabled={busy} className="v-btn !px-2.5 !py-1 text-xs [@media(pointer:coarse)]:min-h-11"
                                  onClick={() => runAction(r.key, () => actions.onArchive(r, !r.archivedAt))}>
                                  {r.archivedAt ? "Restore" : "Archive"}
                                </button>
                                {confirmingDelete ? (
                                  <span className="inline-flex items-center gap-1">
                                    <button type="button" disabled={busy}
                                      className="rounded-lg bg-red-600 px-2.5 py-1 text-xs [@media(pointer:coarse)]:min-h-11 font-medium text-white hover:bg-red-700"
                                      onClick={() => runAction(r.key, async () => { await actions.onDelete(r); setConfirmDeleteKey(null); })}>
                                      Confirm
                                    </button>
                                    <button type="button" className="v-btn !px-2 !py-1 text-xs [@media(pointer:coarse)]:min-h-11" onClick={() => setConfirmDeleteKey(null)}>Cancel</button>
                                  </span>
                                ) : (
                                  <button type="button" disabled={busy}
                                    className="rounded-lg border border-red-200 px-2.5 py-1 text-xs [@media(pointer:coarse)]:min-h-11 font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                                    onClick={() => setConfirmDeleteKey(r.key)}>
                                    Delete
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}


/** Convex-backed data: only mounted when a cloud session exists (hooks need the provider). */
function CloudDashboard() {
  const s = useCloudSession()!;
  const convex = useConvex();
  const router = useRouter();
  const { local, localExams, localFolders, layoutScans, totalScans } = useDeviceSheet();
  const orgId = s.workspace.orgId;
  const member = s.workspace.access === "member" && !!orgId;
  const admin = member && isAdmin(s.workspace.role);
  const canManage = !member || (s.workspace.role !== null && s.workspace.role !== "viewer");

  const examsQ = useQuery(api.exams.listByOrg, member ? { orgId: orgId! } : "skip");
  const foldersQ = useQuery(api.examFolders.listByOrg, member ? { orgId: orgId! } : "skip");
  const syllabiQ = useQuery(api.syllabi.listByOrg, member ? { orgId: orgId! } : "skip");
  const pendingQ = useQuery(api.admin.pendingCount, admin ? { orgId: orgId! } : "skip");

  const duplicateExamM = useMutation(api.exams.duplicate);
  const archiveExamM = useMutation(api.exams.archive);
  const deleteExamM = useMutation(api.exams.remove);
  const setFolderM = useMutation(api.exams.setFolder);
  const createFolderM = useMutation(api.examFolders.create);
  const deleteFolderM = useMutation(api.examFolders.remove);
  const classesQ = useQuery(api.classes.listMine, member && canManage ? { orgId: orgId! } : "skip");
  const createCourseM = useMutation(api.courses.create);
  const updateCourseM = useMutation(api.courses.update);
  const removeCourseM = useMutation(api.courses.remove);
  const addSectionM = useMutation(api.courses.addSection);
  const removeSectionM = useMutation(api.courses.removeSection);
  const setSectionClassM = useMutation(api.courses.setSectionClass);
  const applyToSectionsM = useMutation(api.exams.applyToSections);
  const upsertSyllabusM = useMutation(api.syllabi.upsert);
  const { courses, loaded: coursesLoaded } = useCourses();

  // not a member (or signed out): the workspace has no exams to show, which is a known empty, not "loading"
  const loading = s.isLoading || (s.isAuthenticated && s.workspace.access === "loading");
  const exams: WorkspaceExam[] | undefined = member ? examsQ : loading ? undefined : [];
  const signedIn = !!s.isAuthenticated && !!s.me;

  const rows = dashboardRows({ local, localScanCount: layoutScans, exams, localExams: member ? undefined : localExams }, 200);
  const folders: FolderOption[] = member
    ? (foldersQ ?? []).map((f) => ({ id: f._id, name: f.name, semester: f.semester, schoolYear: f.schoolYear }))
    : localFolders;
  const glance = atAGlance({
    exams,
    local,
    localExams: member ? undefined : localExams,
    localScanCount: totalScans,
    syllabi: member ? (syllabiQ?.length ?? null) : undefined,
    pending: admin ? (pendingQ ?? null) : undefined,
  });

  const actions: ExamActions = {
    canManage,
    onOpen: (r) => {
      if (r.examId) s.selectExam(r.examId as Id<"exams">);
      else if (r.localId) activateLocalExam(r.localId);
      router.push("/grade");
    },
    onScan: (r) => {
      if (r.examId) s.selectExam(r.examId as Id<"exams">);
      else if (r.localId) activateLocalExam(r.localId);
      router.push("/scan");
    },
    onPrint: async (r) => {
      if (r.examId) {
        const got = await convex.query(api.exams.get, { examId: r.examId as Id<"exams"> });
        const parsed = got?.template ? OMRTemplateSchema.safeParse(got.template) : null;
        await downloadExamPdf(parsed?.success ? parsed.data : null, r.name);
      } else if (r.localId) {
        const tpl = listLocalExams().find((e) => e.id === r.localId)?.template;
        await downloadExamPdf(tpl, r.name);
      }
    },
    onCopy: async (r) => {
      if (r.examId) await duplicateExamM({ examId: r.examId as Id<"exams"> });
      else if (r.localId) duplicateLocalExam(r.localId);
    },
    onArchive: async (r, archived) => {
      if (r.examId) await archiveExamM({ examId: r.examId as Id<"exams">, archived });
      else if (r.localId) archiveLocalExam(r.localId, archived);
    },
    onDelete: async (r) => {
      if (r.examId) await deleteExamM({ examId: r.examId as Id<"exams"> });
      else if (r.localId) deleteLocalExam(r.localId);
    },
    onAssignFolder: async (r, folderId) => {
      if (r.examId) await setFolderM({ examId: r.examId as Id<"exams">, folderId: folderId as Id<"examFolders"> | null });
      else if (r.localId) assignLocalExamFolder(r.localId, folderId);
    },
    onCreateFolder: async (input) => {
      if (member && orgId) await createFolderM({ orgId, name: input.name, semester: input.semester, schoolYear: input.schoolYear });
      else createLocalFolder(input);
    },
    onDeleteFolder: async (folderId) => {
      if (member) await deleteFolderM({ folderId: folderId as Id<"examFolders"> });
      else deleteLocalFolder(folderId);
    },
  };

  const courseActions: CourseActions = {
    canManage: canManage && member,
    onCreate: async (input) => { await createCourseM({ orgId: orgId!, code: input.code, title: input.title, semester: input.semester, schoolYear: input.schoolYear, sections: [...(input.sections ?? [])] }); },
    onUpdate: async (courseId, f) => { await updateCourseM({ courseId: courseId as Id<"courses">, code: f.code, title: f.title, semester: f.semester, schoolYear: f.schoolYear, syllabusId: f.syllabusId as Id<"syllabi"> | undefined }); },
    onDelete: async (courseId) => { await removeCourseM({ courseId: courseId as Id<"courses"> }); },
    onAddSection: async (courseId, sectionName) => { await addSectionM({ courseId: courseId as Id<"courses">, name: sectionName }); },
    onRemoveSection: async (courseId, sectionId) => { await removeSectionM({ courseId: courseId as Id<"courses">, sectionId }); },
    onSetSectionClass: async (courseId, sectionId, classId) => { await setSectionClassM({ courseId: courseId as Id<"courses">, sectionId, classId: classId as Id<"classes"> | null }); },
    onBulkApply: async ({ courseId, sectionIds, baseName, sourceExamId, useDeviceSheet }) => {
      if (sourceExamId) {
        await applyToSectionsM({ orgId: orgId!, courseId: courseId as Id<"courses">, sectionIds, baseName, sourceExamId: sourceExamId as Id<"exams"> });
        return;
      }
      const tpl = useDeviceSheet ? readStoredTemplate() : null;
      if (!tpl) throw new Error("Choose an exam design to apply.");
      const plan = readStoredPlan();
      const usePlan = plan && plan.templateId === tpl.templateId && plan.tos.totalQuestions === tpl.questionCount ? plan : null;
      const syllabusId = usePlan ? await upsertSyllabusM({ orgId: orgId!, syllabus: usePlan.syllabus }) : undefined;
      await applyToSectionsM({
        orgId: orgId!,
        courseId: courseId as Id<"courses">,
        sectionIds,
        baseName,
        templateJson: JSON.stringify(tpl),
        ...(usePlan && syllabusId ? { syllabusId, examPeriod: usePlan.period, questionOutcomes: usePlan.assignments } : {}),
      });
    },
  };
  const classes: ClassOption[] = (classesQ ?? []).map((c) => ({ id: c._id, label: classLabel(c.section ? { name: c.name, section: c.section } : { name: c.name }), count: c.count }));

  return <DashboardView name={signedIn ? firstName(s.me?.name) : null} rows={rows} deviceSheet={local} folders={folders} glance={glance} actions={actions} courses={courses} coursesLoaded={coursesLoaded} courseActions={courseActions} classes={classes} />;
}

function LocalDashboard() {
  const router = useRouter();
  const { local, localExams, localFolders, layoutScans, totalScans } = useDeviceSheet();
  const rows = dashboardRows({ local, localScanCount: layoutScans, exams: [], localExams }, 200);
  const glance = atAGlance({ exams: [], local, localExams, localScanCount: totalScans });
  const { courses, loaded: coursesLoaded } = useCourses();
  const localClasses = useLocalClasses();
  const classes: ClassOption[] = (localClasses.list ?? []).map((c) => ({ id: c.id, label: classLabel({ name: c.name, section: c.section ?? undefined }), count: c.count }));
  const courseActions: CourseActions = {
    canManage: true,
    onCreate: (input) => { createLocalCourse(input); },
    onUpdate: (id, f) => { updateLocalCourse(id, f); },
    onDelete: (id) => { deleteLocalCourse(id); },
    onAddSection: (id, sectionName) => { addLocalSection(id, sectionName); },
    onRemoveSection: (id, sectionId) => { removeLocalSection(id, sectionId); },
    onSetSectionClass: (id, sectionId, classId) => { setLocalSectionClass(id, sectionId, classId); },
    onBulkApply: ({ courseId, sectionIds, baseName, sourceExamId, useDeviceSheet }) => {
      applyDesignToLocalSections({
        courseId,
        sectionIds,
        baseName,
        sourceExamId: sourceExamId ?? null,
        template: useDeviceSheet ? readStoredTemplate() : null,
      });
    },
  };

  const actions: ExamActions = {
    canManage: true,
    onOpen: (r) => {
      if (r.localId) activateLocalExam(r.localId);
      router.push("/grade");
    },
    onScan: (r) => {
      if (r.localId) activateLocalExam(r.localId);
      router.push("/scan");
    },
    onPrint: async (r) => {
      const tpl = r.localId ? listLocalExams().find((e) => e.id === r.localId)?.template : null;
      await downloadExamPdf(tpl, r.name);
    },
    onCopy: (r) => { if (r.localId) duplicateLocalExam(r.localId); },
    onArchive: (r, archived) => { if (r.localId) archiveLocalExam(r.localId, archived); },
    onDelete: (r) => { if (r.localId) deleteLocalExam(r.localId); },
    onAssignFolder: (r, folderId) => { if (r.localId) assignLocalExamFolder(r.localId, folderId); },
    onCreateFolder: (input) => { createLocalFolder(input); },
    onDeleteFolder: (folderId) => { deleteLocalFolder(folderId); },
  };

  return <DashboardView name={null} rows={rows} deviceSheet={local} folders={localFolders} glance={glance} actions={actions} courses={courses} coursesLoaded={coursesLoaded} courseActions={courseActions} classes={classes} />;
}

export default function Dashboard() {
  return useCloudSession() ? <CloudDashboard /> : <LocalDashboard />;
}
