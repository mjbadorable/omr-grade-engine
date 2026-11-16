/** Pure helpers for the instant scan card: who is this sheet, and changing it (audit-logged). */
import { makePatch, type ManualOverridePatch } from "@/lib/review/overrides";
import { rollKey, type Roster, type Student } from "@/lib/roster/schema";

export function findStudent(roster: Roster | null, roll: string | null): Student | null {
  const key = rollKey(roll);
  if (!roster || !key) return null;
  return roster.students.find((s) => rollKey(s.rollNumber) === key) ?? null;
}

/** Roster students matching a search (name or roll), exact roll first. Empty search lists the first few. */
export function studentChoices(roster: Roster | null, query: string, limit = 8): Student[] {
  if (!roster) return [];
  const q = query.trim().toLowerCase();
  if (!q) return roster.students.slice(0, limit);
  const qKey = rollKey(query);
  const hit = roster.students.filter((s) => s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q) || (qKey !== null && rollKey(s.rollNumber) === qKey));
  const exact = (s: Student) => (qKey !== null && rollKey(s.rollNumber) === qKey ? 0 : 1);
  return hit.map((s, i) => ({ s, i })).sort((a, b) => exact(a.s) - exact(b.s) || a.i - b.i).map((x) => x.s).slice(0, limit);
}

/** The scanner's reading is never edited; a corrected roll is an append-only override patch. */
export function rollChangePatch(i: { sheetId: string; scannedRoll: string | null; newRoll: string; teacherId: string }): ManualOverridePatch {
  return makePatch({
    sheetId: i.sheetId, target: "roll", questionNumber: 0,
    originalState: { value: i.scannedRoll }, overriddenOption: i.newRoll,
    reason: "Changed student when the sheet was scanned", teacherId: i.teacherId,
  });
}
