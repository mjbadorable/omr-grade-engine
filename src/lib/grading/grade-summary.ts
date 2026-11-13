/**
 * Teacher-facing summary of the graded sheets (pure, derived only from the scored sheets).
 *
 * Rule: every sheet is classified exactly once, by priority  needs review > duplicate > graded.
 * A sheet "needs review" when it has flagged answers or any sheet-level flag. Sheets held by an
 * unresolved sync conflict already carry the SYNC_CONFLICT sheet flag, so they are covered by the
 * same rule and can never be counted twice. Hence  graded + needsReview = number of sheets
 * (a clean sheet whose roll number repeats is shown as "Duplicate" but still counts as graded).
 */
import type { ScoredSheet } from "./types";

export type SummarySheet = Pick<ScoredSheet, "sheetId" | "rollNumber" | "percentage" | "flaggedCount" | "sheetFlags">;
export type SheetStatusId = "graded" | "needs-review" | "duplicate";

export const needsReview = (s: SummarySheet) => s.flaggedCount > 0 || s.sheetFlags.length > 0;

export function sheetStatus(s: SummarySheet, isDuplicate: boolean): { status: SheetStatusId; label: string } {
  if (needsReview(s)) return { status: "needs-review", label: "Needs Review" };
  if (isDuplicate) return { status: "duplicate", label: "Duplicate" };
  return { status: "graded", label: "Graded" };
}

/** Readable roll numbers that appear on more than one sheet. */
export function duplicateRolls(sheets: readonly SummarySheet[]): Set<string> {
  const seen = new Map<string, number>();
  for (const s of sheets) if (s.rollNumber) seen.set(s.rollNumber, (seen.get(s.rollNumber) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([roll]) => roll));
}

export interface GradeSummary { students: number; graded: number; needsReview: number; classAverage: number | null }

export function gradeSummary(sheets: readonly SummarySheet[]): GradeSummary {
  const review = sheets.filter(needsReview).length;
  const rolls = new Set(sheets.filter((s) => s.rollNumber).map((s) => s.rollNumber));
  const unreadable = sheets.filter((s) => !s.rollNumber).length;
  const avg = sheets.length ? Math.round((sheets.reduce((n, s) => n + s.percentage, 0) / sheets.length) * 10) / 10 : null;
  return { students: rolls.size + unreadable, graded: sheets.length - review, needsReview: review, classAverage: avg };
}
