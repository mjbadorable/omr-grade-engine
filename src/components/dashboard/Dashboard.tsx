"use client";
/**
 * Teacher Dashboard: greeting, four quick actions, Examinations (with semester folders,
 * copy, archive, and delete) and At a Glance. Every number comes from this device
 * (saved sheet + IndexedDB scans) or the workspace's real queries; unknown values show "–"
 * and an empty account gets an empty state, never sample rows.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BrandMark } from "@/components/brand/Brand";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { Icon } from "@/components/shell/Rail";
import { TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import { atAGlance, dashboardRows, firstName, greeting, type DashboardRow, type GlanceTile, type LocalLibraryExam, type LocalSheet, type WorkspaceExam } from "@/lib/dashboard";
import { isAdmin } from "@/lib/roles/policy";
import {
  activateLocalExam,
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
  onAssignFolder: (r: DashboardRow, folderId: string | null) => void | Promise<void>;
  onCreateFolder: (input: { name: string; semester: string; schoolYear?: string }) => void | Promise<void>;
  onDeleteFolder: (folderId: string) => void | Promise<void>;
}

const ACTIONS = [
  { id: "design", label: "Design Exam", text: "Set up an answer sheet and print it.", href: "/designer", primary: true },
  { id: "scan", label: "Scan Sheets", text: "Photograph or upload completed sheets.", href: "/scan", primary: false },
  { id: "grade", label: "Grade Exam", text: "Review scores, answer keys and results.", href: "/grade", primary: false },
  { id: "reports", label: "Reports", text: "Item analysis and course outcomes.", href: "/grade?tab=analysis", primary: false },
] as const;

const fmtDate = (t: number | null) => (t === null ? "–" : new Date(t).toLocaleDateString(undefined, { dateStyle: "medium" }));
const num = (n: number | null) => (n === null ? "–" : String(n));

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
      if (t && !listLocalExams().some((e) => e.template.layoutHash === t.layoutHash)) upsertLocalExam(t);
      setLocal(t ? { title: t.title, layoutHash: t.layoutHash, templateId: t.templateId } : null);
      setLocalExams(
        listLocalExams().map((e) => ({
          id: e.id,
          name: e.name,
          layoutHash: e.template.layoutHash,
          folderId: e.folderId,
          archivedAt: e.archivedAt,
          createdAt: e.createdAt,
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

function DashboardView({
  name,
  rows,
  folders,
  glance,
  actions,
}: {
  name: string | null;
  rows: DashboardRow[];
  folders: FolderOption[];
  glance: GlanceTile[];
  actions: ExamActions;
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

  useEffect(() => { setHour(new Date().getHours()); }, []);

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

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6" data-testid="dashboard">
      <header>
        <h1 className="text-2xl font-bold" data-testid="dashboard-greeting">{hour === null ? "Welcome" : greeting(hour)}{name ? `, ${name}` : ""}</h1>
        <p className="mt-2 text-sm text-zinc-500">Design an exam, scan the sheets and grade them, all in one place.</p>
      </header>

      <section aria-label="Quick actions" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="quick-actions">
        {ACTIONS.map((a) => (
          <Link key={a.id} href={a.href} data-testid={`action-${a.id}`}
            className={`group flex flex-col gap-4 rounded-2xl p-6 transition duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${a.primary ? "v-tile-primary" : "v-tile-glass"}`}>
            <span className={`grid size-10 place-items-center rounded-lg ${a.primary ? "bg-white/15 text-white" : "bg-[var(--brand-tint)] text-[var(--brand)]"}`}><Icon id={a.id} /></span>
            <span>
              <span className="block text-base font-semibold">{a.label}</span>
              <span className={`mt-2 block text-sm ${a.primary ? "text-white/80" : "text-zinc-500"}`}>{a.text}</span>
            </span>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="recent-title" className="v-panel min-w-0 overflow-hidden lg:col-span-2" data-testid="recent-exams">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-6">
            <h2 id="recent-title" className="text-base font-semibold">Recent Examinations</h2>
            <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-900" role="tablist" aria-label="Exam status filter">
              <button type="button" role="tab" aria-selected={!showArchived} onClick={() => setShowArchived(false)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${!showArchived ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                Active ({activeCount})
              </button>
              <button type="button" role="tab" aria-selected={showArchived} onClick={() => setShowArchived(true)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${showArchived ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                Archived ({archivedCount})
              </button>
            </div>
            {rows.length > 0 && <Link href="/grade" className="ml-auto text-sm font-medium text-[var(--brand)] hover:underline">Open Gradebook</Link>}
          </div>

          {/* Semester Folder Bar */}
          <div className="space-y-3 border-b border-[var(--border)] bg-zinc-50/60 px-6 py-3 dark:bg-zinc-900/40" data-testid="semester-folders-bar">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-zinc-500">Semester Folder:</span>
              <button type="button" onClick={() => setSelectedFolder("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${selectedFolder === "all" ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] bg-white/80 text-zinc-600 hover:border-[var(--brand-soft)] dark:bg-zinc-900 dark:text-zinc-300"}`}>
                All
              </button>
              {folders.map((f) => {
                const count = rows.filter((r) => (showArchived ? !!r.archivedAt : !r.archivedAt) && r.folderId === f.id).length;
                const active = selectedFolder === f.id;
                return (
                  <span key={f.id} className={`inline-flex items-center gap-1 rounded-full pl-3 pr-1.5 py-1 text-xs font-medium transition ${active ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] bg-white/80 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
                    <button type="button" onClick={() => setSelectedFolder(f.id)} title={`${f.semester}${f.schoolYear ? ` · ${f.schoolYear}` : ""}`}>
                      {f.name} ({count})
                    </button>
                    {actions.canManage && (
                      <button type="button" aria-label={`Delete folder ${f.name}`}
                        onClick={() => runAction(`del-folder:${f.id}`, async () => {
                          await actions.onDeleteFolder(f.id);
                          if (selectedFolder === f.id) setSelectedFolder("all");
                        })}
                        className={`rounded-full px-1 leading-none opacity-75 hover:opacity-100 ${active ? "hover:bg-white/20" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              <button type="button" onClick={() => setSelectedFolder("unfiled")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${selectedFolder === "unfiled" ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] bg-white/80 text-zinc-600 hover:border-[var(--brand-soft)] dark:bg-zinc-900 dark:text-zinc-300"}`}>
                Unfiled
              </button>
              {actions.canManage && (
                <button type="button" data-testid="new-folder-btn" onClick={() => { setCreatingFolder((v) => !v); setErr(null); }}
                  className="ml-auto rounded-full border border-dashed border-[var(--brand-soft)] px-3 py-1 text-xs font-medium text-[var(--brand)] hover:bg-[var(--brand-tint)]">
                  + New Folder
                </button>
              )}
            </div>

            {creatingFolder && (
              <form onSubmit={handleCreateFolder} className="grid gap-2 rounded-xl border border-[var(--border)] bg-white p-3 sm:grid-cols-4 dark:bg-zinc-950" data-testid="new-folder-form">
                <input id="new-folder-name" name="folderName" type="text" placeholder="Folder name (e.g. 1st Sem 2026-2027)" value={folderName} onChange={(e) => setFolderName(e.target.value)}
                  className="v-input text-xs sm:col-span-2" aria-label="Folder name" required />
                <select id="new-folder-semester" name="semester" value={semester} onChange={(e) => setSemester(e.target.value)} className="v-input text-xs" aria-label="Semester">
                  {SEMESTER_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="flex gap-2">
                  <input id="new-folder-year" name="schoolYear" type="text" placeholder="School year" value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)}
                    className="v-input w-full text-xs" aria-label="School year" />
                  <button type="submit" disabled={busyKey === "new-folder"} className="v-btn v-btn-primary shrink-0 !px-3 !py-1 text-xs">
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
                            <select
                              id={`folder-${r.key}`}
                              name={`folder-${r.key}`}
                              aria-label={`Semester folder for ${r.name}`}
                              value={r.folderId ?? ""}
                              disabled={busy}
                              onChange={(e) => runAction(r.key, () => actions.onAssignFolder(r, e.target.value || null))}
                              className="v-input !py-1 !px-2 text-xs max-w-[150px]">
                              <option value="">Unfiled</option>
                              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                          ) : (
                            <span className="text-xs text-zinc-500">{folder ? folder.name : "Unfiled"}</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`v-badge ${r.status === "Open" ? "v-badge-ok" : r.status === "Draft" ? "v-badge-gold" : ""}`}>{r.status}</span>
                        </td>
                        <td className="v-mono px-4 py-4 text-right">{num(r.scanned)}</td>
                        <td className="px-4 py-4 text-zinc-500">{fmtDate(r.createdAt)}</td>
                        <td className="px-4 py-4 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button type="button" className="v-btn !px-3 !py-1 text-xs" onClick={() => actions.onOpen(r)}>Open</button>
                            {actions.canManage && (
                              <>
                                <button type="button" disabled={busy} className="v-btn !px-2.5 !py-1 text-xs"
                                  onClick={() => runAction(r.key, () => actions.onCopy(r))} title="Copy set-up exam">
                                  Copy
                                </button>
                                <button type="button" disabled={busy} className="v-btn !px-2.5 !py-1 text-xs"
                                  onClick={() => runAction(r.key, () => actions.onArchive(r, !r.archivedAt))}>
                                  {r.archivedAt ? "Restore" : "Archive"}
                                </button>
                                {confirmingDelete ? (
                                  <span className="inline-flex items-center gap-1">
                                    <button type="button" disabled={busy}
                                      className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                                      onClick={() => runAction(r.key, async () => { await actions.onDelete(r); setConfirmDeleteKey(null); })}>
                                      Confirm
                                    </button>
                                    <button type="button" className="v-btn !px-2 !py-1 text-xs" onClick={() => setConfirmDeleteKey(null)}>Cancel</button>
                                  </span>
                                ) : (
                                  <button type="button" disabled={busy}
                                    className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
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

        <section aria-labelledby="glance-title" className="v-panel p-6" data-testid="at-a-glance">
          <h2 id="glance-title" className="text-base font-semibold">At a Glance</h2>
          <dl className="mt-4 space-y-4">
            {glance.filter((t) => t.available).map((t) => (
              <div key={t.id} className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] pb-4 last:border-0 last:pb-0" data-testid={`glance-${t.id}`}>
                <dt className="text-sm text-zinc-500">{t.label}</dt>
                <dd className="v-mono text-2xl font-bold">{num(t.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-xs text-zinc-500">Counts come from this device and your workspace.</p>
        </section>
      </div>
    </div>
  );
}

/** Convex-backed data: only mounted when a cloud session exists (hooks need the provider). */
function CloudDashboard() {
  const s = useCloudSession()!;
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

  // not a member (or signed out): the workspace has no exams to show, which is a known empty, not "loading"
  const loading = s.isLoading || (s.isAuthenticated && s.workspace.access === "loading");
  const exams: WorkspaceExam[] | undefined = member ? examsQ : loading ? undefined : [];
  const signedIn = !!s.isAuthenticated && !!s.me;

  const rows = dashboardRows({ local, localScanCount: layoutScans, exams, localExams: member ? undefined : localExams }, 50);
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

  return <DashboardView name={signedIn ? firstName(s.me?.name) : null} rows={rows} folders={folders} glance={glance} actions={actions} />;
}

function LocalDashboard() {
  const router = useRouter();
  const { local, localExams, localFolders, layoutScans, totalScans } = useDeviceSheet();
  const rows = dashboardRows({ local, localScanCount: layoutScans, exams: [], localExams }, 50);
  const glance = atAGlance({ exams: [], local, localExams, localScanCount: totalScans });

  const actions: ExamActions = {
    canManage: true,
    onOpen: (r) => {
      if (r.localId) activateLocalExam(r.localId);
      router.push("/grade");
    },
    onCopy: (r) => { if (r.localId) duplicateLocalExam(r.localId); },
    onArchive: (r, archived) => { if (r.localId) archiveLocalExam(r.localId, archived); },
    onDelete: (r) => { if (r.localId) deleteLocalExam(r.localId); },
    onAssignFolder: (r, folderId) => { if (r.localId) assignLocalExamFolder(r.localId, folderId); },
    onCreateFolder: (input) => { createLocalFolder(input); },
    onDeleteFolder: (folderId) => { deleteLocalFolder(folderId); },
  };

  return <DashboardView name={null} rows={rows} folders={localFolders} glance={glance} actions={actions} />;
}

export default function Dashboard() {
  return useCloudSession() ? <CloudDashboard /> : <LocalDashboard />;
}
