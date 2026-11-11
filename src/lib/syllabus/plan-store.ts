/**
 * The teacher's current syllabus plan (syllabus + exam period + TOS), kept in this browser so the
 * designer, the gradebook and the cloud "create exam" button share it without any typing.
 */
import { assignOutcomes, type QuestionOutcome, type Tos } from "./tos";
import { SyllabusSchema, type ExamPeriod, type Syllabus } from "./types";

export interface SyllabusPlan {
  syllabus: Syllabus;
  period: ExamPeriod;
  tos: Tos;
  /** question → module / CO, derived from the TOS (stored so the gradebook needs no recomputation) */
  assignments: QuestionOutcome[];
  /** sheet template the plan was configured for (the gradebook only auto-applies it to that sheet) */
  templateId?: string;
  savedAt: number;
}

const KEY = "omr:syllabusPlan";

export function makePlan(syllabus: Syllabus, period: ExamPeriod, tos: Tos, opts: { templateId?: string; now?: number } = {}): SyllabusPlan {
  return { syllabus, period, tos, assignments: assignOutcomes(tos, syllabus), ...(opts.templateId ? { templateId: opts.templateId } : {}), savedAt: opts.now ?? Date.now() };
}

export function readStoredPlan(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): SyllabusPlan | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SyllabusPlan;
    const s = SyllabusSchema.safeParse(p.syllabus);
    if (!s.success || !Array.isArray(p.assignments) || !p.tos) return null;
    return { ...p, syllabus: s.data };
  } catch { return null; }
}

export function writeStoredPlan(plan: SyllabusPlan | null, storage: Pick<Storage, "setItem" | "removeItem"> | null = typeof localStorage === "undefined" ? null : localStorage): void {
  try {
    if (!plan) storage?.removeItem(KEY);
    else storage?.setItem(KEY, JSON.stringify(plan));
  } catch { /* quota / private mode: the plan simply is not remembered */ }
}
