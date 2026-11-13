/**
 * Teacher Dashboard data (pure). Everything shown comes from the sheet saved on this device
 * (localStorage + IndexedDB scan count) and the workspace's real exams (`exams.listByOrg`).
 * A value that is not known yet is `null` (shown as "–"), never a made-up number.
 */
import { PERIOD_LABEL, type ExamPeriod } from "@/lib/syllabus/types";

export interface LocalSheet { title: string; layoutHash: string; templateId?: string }
export interface LocalLibraryExam { id: string; name: string; layoutHash: string; folderId: string | null; archivedAt: number | null; createdAt: number }
export interface WorkspaceExam {
  _id: string;
  name: string;
  layoutHash: string;
  status: string;
  currentKeyVersion?: number;
  examPeriod?: string | null;
  folderId?: string | null;
  archivedAt?: number | null;
  createdAt: number;
}

export interface DashboardRow {
  key: string;
  /** workspace exam id, or null for a sheet that only exists on this device */
  examId: string | null;
  /** local library exam id when stored in omr:localExams */
  localId?: string | null;
  name: string;
  where: "This device" | "Workspace";
  status: string;
  period: string | null;
  folderId?: string | null;
  archivedAt?: number | null;
  /** sheets scanned on this device for this layout; null = unknown */
  scanned: number | null;
  /** creation time (workspace exams only); null = unknown */
  createdAt: number | null;
}

export function greeting(hour: number): string {
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
}

/** First word of the signed-in display name. Never guessed from an email address. */
export function firstName(name: string | null | undefined): string | null {
  const w = name?.trim().split(/\s+/)[0];
  return w ? w : null;
}

const STATUS: Record<string, string> = { draft: "Draft", open: "Open", closed: "Closed" };
const periodLabel = (p: string | null | undefined) => (p && p in PERIOD_LABEL ? PERIOD_LABEL[p as ExamPeriod] : null);

export function dashboardRows(
  i: {
    local: LocalSheet | null;
    localScanCount: number | null;
    exams: readonly WorkspaceExam[] | undefined;
    localExams?: readonly LocalLibraryExam[];
  },
  limit = 8,
): DashboardRow[] {
  const exams = [...(i.exams ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const rows: DashboardRow[] = exams.map((e) => ({
    key: e._id,
    examId: e._id,
    name: e.name,
    where: "Workspace",
    status: e.archivedAt ? "Archived" : (STATUS[e.status] ?? e.status),
    period: periodLabel(e.examPeriod),
    folderId: e.folderId ?? null,
    archivedAt: e.archivedAt ?? null,
    // the device only knows the scans of the sheet it holds
    scanned: i.local && i.local.layoutHash === e.layoutHash ? i.localScanCount : null,
    createdAt: e.createdAt,
  }));
  const localExtras = [...(i.localExams ?? [])]
    .filter((le) => !exams.some((e) => e.layoutHash === le.layoutHash))
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const le of localExtras) {
    rows.push({
      key: `local:${le.id}`,
      examId: null,
      localId: le.id,
      name: le.name,
      where: "This device",
      status: le.archivedAt ? "Archived" : "Draft",
      period: null,
      folderId: le.folderId,
      archivedAt: le.archivedAt,
      scanned: i.local && i.local.layoutHash === le.layoutHash ? i.localScanCount : null,
      createdAt: le.createdAt,
    });
  }
  if (i.local && !exams.some((e) => e.layoutHash === i.local!.layoutHash) && !localExtras.some((le) => le.layoutHash === i.local!.layoutHash)) {
    rows.unshift({
      key: `device:${i.local.layoutHash}`,
      examId: null,
      name: i.local.title.trim() || i.local.templateId || "Untitled exam",
      where: "This device",
      status: "Draft",
      period: null,
      folderId: null,
      archivedAt: null,
      scanned: i.localScanCount,
      createdAt: null,
    });
  }
  return rows.slice(0, limit);
}

export interface GlanceTile { id: "exams" | "scanned" | "syllabi" | "pending"; label: string; value: number | null; /** false = not offered to this user / mode (hide the tile) */ available: boolean }

/**
 * `localScanCount` is every scan stored on this device (null = not read yet).
 * `exams` undefined = still loading (null value). `syllabi` / `pending`: undefined = not offered here
 * (local-only mode, or not an admin), null = offered but still loading, number = real count.
 */
export function atAGlance(i: {
  exams: readonly WorkspaceExam[] | undefined;
  local?: LocalSheet | null;
  localExams?: readonly LocalLibraryExam[];
  localScanCount: number | null;
  syllabi?: number | null;
  pending?: number | null;
}): GlanceTile[] {
  const activeWorkspace = i.exams?.filter((e) => !e.archivedAt);
  const localOnlyCount = (i.localExams ?? []).filter((le) => !le.archivedAt && !i.exams?.some((e) => e.layoutHash === le.layoutHash)).length;
  const draftOnly = localOnlyCount > 0
    ? localOnlyCount
    : (i.local && !i.exams?.some((e) => e.layoutHash === i.local!.layoutHash) ? 1 : 0);
  return [
    { id: "exams", label: "Examinations", value: activeWorkspace ? activeWorkspace.length + draftOnly : null, available: true },
    { id: "scanned", label: "Sheets scanned on this device", value: i.localScanCount, available: true },
    { id: "syllabi", label: "Syllabi", value: i.syllabi ?? null, available: i.syllabi !== undefined },
    { id: "pending", label: "Pending access", value: i.pending ?? null, available: i.pending !== undefined },
  ];
}
