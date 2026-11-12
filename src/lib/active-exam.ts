/**
 * The "active exam" ties Design → Scan → Grade together. In the header the teacher sees ONE exam:
 *   cloud : an exam saved in the shared workspace and selected
 *   match : the sheet designed on this device is already saved as a cloud exam → just select it
 *   draft : the sheet exists only on this device → it is saved to the workspace automatically
 *           once it is printed, scanned or graded (so every layout tweak does not create an exam)
 *   none  : nothing designed or selected yet
 */
import { atLeast, type Role } from "@/lib/roles/policy";

export interface ExamLite { _id: string; name: string; layoutHash: string }
export interface LocalSheet { title: string; layoutHash: string }

export type ActiveExam =
  | { kind: "cloud"; exam: ExamLite }
  | { kind: "match"; exam: ExamLite }
  | { kind: "draft"; title: string; layoutHash: string }
  | { kind: "none" };

export function resolveActiveExam(i: { exams: readonly ExamLite[] | undefined; selectedExamId: string | null; local: LocalSheet | null }): ActiveExam {
  const selected = i.selectedExamId ? i.exams?.find((e) => e._id === i.selectedExamId) : undefined;
  if (selected) return { kind: "cloud", exam: selected };
  if (i.local) {
    const m = i.exams?.find((e) => e.layoutHash === i.local!.layoutHash);
    return m ? { kind: "match", exam: m } : { kind: "draft", title: i.local.title, layoutHash: i.local.layoutHash };
  }
  return { kind: "none" };
}

/** Save the draft sheet to the workspace now? Only for people who can create exams, once per layout. */
export function shouldAutoSave(i: { active: ActiveExam; signedIn: boolean; role: Role | null; path: string | null; printedHash: string | null; inFlight: ReadonlySet<string>; examsLoaded: boolean }): boolean {
  if (i.active.kind !== "draft" || !i.signedIn || !i.examsLoaded || !atLeast(i.role, "teacher")) return false;
  if (i.inFlight.has(i.active.layoutHash)) return false;
  const onWorkPage = !!i.path && (i.path.startsWith("/scan") || i.path.startsWith("/grade"));
  return onWorkPage || i.printedHash === i.active.layoutHash;
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", teacher: "Teacher", viewer: "Viewer" };
export const ROLE_CLASS: Record<Role, string> = {
  owner: "bg-indigo-600 text-white",
  admin: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200",
  teacher: "bg-gold-tint text-gold-hover ring-1 ring-inset ring-gold/40 dark:text-gold",
  viewer: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export const TEMPLATE_CHANGED_EVENT = "veritas:template-changed";
export const SHEET_PRINTED_EVENT = "veritas:sheet-printed";
