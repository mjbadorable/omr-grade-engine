/**
 * Roster ↔ scanned-sheet reconciliation (pure).
 *
 *   MATCHED               roster student with ≥ 1 sheet (duplicateSheets flags rescans)
 *   UNREGISTERED_STUDENT  scanned roll number that is not on the roster
 *   ABSENT                roster student without a sheet
 *   UNREADABLE_ROLL       sheet whose roll number could not be decoded (needs a manual override)
 */
import { rollKey, type Roster, type Student } from "./schema";

export interface SheetRef { sheetId: string; rollNumber: string | null }

export type ReconcileEntry =
  | { status: "MATCHED"; key: string; student: Student; sheetIds: string[]; duplicateSheets: boolean }
  | { status: "UNREGISTERED_STUDENT"; key: string; rollNumber: string; sheetIds: string[] }
  | { status: "ABSENT"; key: string; student: Student }
  | { status: "UNREADABLE_ROLL"; key: null; sheetIds: string[] };

export interface Reconciliation {
  entries: ReconcileEntry[];
  /** sheetId → roster student (MATCHED only) */
  studentBySheet: Map<string, Student>;
  summary: { roster: number; matched: number; unregistered: number; absent: number; unreadable: number; duplicates: number };
}

export function reconcile(roster: Roster | null, sheets: readonly SheetRef[]): Reconciliation {
  const students = roster?.students ?? [];
  const byKey = new Map<string, Student>();
  for (const s of students) {
    const k = rollKey(s.rollNumber);
    if (k && !byKey.has(k)) byKey.set(k, s);
  }
  const sheetsByKey = new Map<string, SheetRef[]>();
  const unreadable: string[] = [];
  for (const sh of sheets) {
    const k = rollKey(sh.rollNumber);
    if (!k) { unreadable.push(sh.sheetId); continue; }
    (sheetsByKey.get(k) ?? sheetsByKey.set(k, []).get(k)!).push(sh);
  }

  const entries: ReconcileEntry[] = [];
  const studentBySheet = new Map<string, Student>();
  for (const [k, student] of byKey) {
    const list = sheetsByKey.get(k);
    if (list?.length) {
      entries.push({ status: "MATCHED", key: k, student, sheetIds: list.map((s) => s.sheetId), duplicateSheets: list.length > 1 });
      for (const s of list) studentBySheet.set(s.sheetId, student);
    } else entries.push({ status: "ABSENT", key: k, student });
  }
  for (const [k, list] of sheetsByKey) {
    if (!byKey.has(k)) entries.push({ status: "UNREGISTERED_STUDENT", key: k, rollNumber: list[0].rollNumber!, sheetIds: list.map((s) => s.sheetId) });
  }
  if (unreadable.length) entries.push({ status: "UNREADABLE_ROLL", key: null, sheetIds: unreadable });

  const count = (s: ReconcileEntry["status"]) => entries.filter((e) => e.status === s).length;
  return {
    entries,
    studentBySheet,
    summary: {
      roster: byKey.size,
      matched: count("MATCHED"),
      unregistered: count("UNREGISTERED_STUDENT"),
      absent: count("ABSENT"),
      unreadable: unreadable.length,
      duplicates: entries.filter((e) => e.status === "MATCHED" && e.duplicateSheets).length,
    },
  };
}
