/**
 * Grading scales (pure). The stored shape stays `gradeBands: { minPercent, label }[]`, so keys,
 * sync and the scorer's `gradeFor` are unchanged.
 *
 * "Round the percentage to the nearest whole number" is stored without a new field: a cutoff the
 * teacher reads as "96%" is saved as 95.5, because a percentage of 95.5 or more rounds up to 96.
 * `gradeFor` then gives exactly the round-then-look-up result.
 */
import { DEFAULT_GRADE_BANDS } from "./answer-key";
import type { GradeBand } from "./types";

export interface CutoffRow { label: string; /** whole percent the grade starts at, as the teacher reads it */ from: number }
export type ScaleId = "letter" | "percent" | "ph" | "usa";
export type DetectedScale = { id: ScaleId | "custom"; rounded: boolean };

export const MAX_ROWS = 30;
export const MAX_LABEL = 20;

/** Standard Philippine college 1.00–5.00 table (3.00 = 75% passing cutoff, 5.00 < 75%). */
export const PH_ROWS: CutoffRow[] = [
  { label: "1.00", from: 97 }, { label: "1.25", from: 94 }, { label: "1.50", from: 91 }, { label: "1.75", from: 88 },
  { label: "2.00", from: 84 }, { label: "2.25", from: 80 }, { label: "2.50", from: 78 }, { label: "2.75", from: 76 },
  { label: "3.00", from: 75 }, { label: "5.00", from: 0 },
];
/** University of San Agustin 1.0–5.0 grade points (3.0 = 75% passing cutoff, 5.0 below 75%). Whole-percent cutoffs, highest first. */
export const USA_ROWS: CutoffRow[] = [
  { label: "1.0", from: 100 }, { label: "1.1", from: 99 }, { label: "1.2", from: 97 }, { label: "1.3", from: 96 },
  { label: "1.4", from: 95 }, { label: "1.5", from: 94 }, { label: "1.6", from: 93 }, { label: "1.7", from: 91 },
  { label: "1.8", from: 90 }, { label: "1.9", from: 89 }, { label: "2.0", from: 88 }, { label: "2.1", from: 86 },
  { label: "2.2", from: 85 }, { label: "2.3", from: 84 }, { label: "2.4", from: 83 }, { label: "2.5", from: 81 },
  { label: "2.6", from: 80 }, { label: "2.7", from: 79 }, { label: "2.8", from: 78 }, { label: "2.9", from: 76 },
  { label: "3.0", from: 75 }, { label: "5.0", from: 0 },
];
const LETTER_ROWS: CutoffRow[] = DEFAULT_GRADE_BANDS.map((b) => ({ label: b.label, from: b.minPercent })).sort((a, b) => b.from - a.from);
const PERCENT_ROWS: CutoffRow[] = [{ label: "Passed", from: 60 }, { label: "Failed", from: 0 }];

export const SCALE_PRESETS: { id: ScaleId; name: string; rows: CutoffRow[]; rounded: boolean; hint: string }[] = [
  { id: "letter", name: "Letter (A to F)", rows: LETTER_ROWS, rounded: false, hint: "A 90, B 80, C 70, D 60, F below." },
  { id: "percent", name: "Percent (Passed / Failed)", rows: PERCENT_ROWS, rounded: false, hint: "Passed from 60%. Edit the cutoff to your school's passing mark." },
  { id: "ph", name: "Philippine college (1.0 to 5.0)", rows: PH_ROWS, rounded: true, hint: "Percentage is rounded to a whole number, then stepped: 1.00 from 97% down to 3.00 at 75%; 5.00 below 75%." },
  { id: "usa", name: "USA Grading (1.0 to 5.0)", rows: USA_ROWS, rounded: false, hint: "USA numeric grading scale: 1.0 (100%) down to 3.0 (75% passing cutoff); 5.0 below 75%." },
];

const byFromDesc = (a: CutoffRow, b: CutoffRow) => b.from - a.from;
const preset = (id: ScaleId) => SCALE_PRESETS.find((p) => p.id === id)!;

/** Table rows → stored bands. `rounded` shifts every cutoff above 0 down by half a percent. */
export function bandsFromRows(rows: readonly CutoffRow[], rounded: boolean): GradeBand[] {
  return [...rows].sort(byFromDesc).map((r) => ({ label: r.label.trim(), minPercent: rounded && r.from > 0 ? r.from - 0.5 : r.from }));
}

export function bandsForPreset(id: ScaleId, opts: { rounded?: boolean } = {}): GradeBand[] {
  const p = preset(id);
  return bandsFromRows(p.rows, opts.rounded ?? p.rounded);
}

const isRounded = (bands: readonly GradeBand[]) => {
  const above = bands.filter((b) => b.minPercent > 0);
  return above.length > 0 && above.every((b) => Math.abs(b.minPercent % 1) === 0.5);
};

/** Stored bands → the whole-percent table a teacher edits. */
export function cutoffRows(bands: readonly GradeBand[]): CutoffRow[] {
  const rounded = isRounded(bands);
  return bands.map((b) => ({ label: b.label, from: rounded && b.minPercent > 0 ? b.minPercent + 0.5 : b.minPercent })).sort(byFromDesc);
}

export function detectScale(bands: readonly GradeBand[]): DetectedScale {
  const rounded = isRounded(bands);
  const rows = cutoffRows(bands);
  for (const p of SCALE_PRESETS) {
    if (p.rows.length === rows.length && p.rows.every((r, i) => r.label === rows[i].label && r.from === rows[i].from)) return { id: p.id, rounded };
  }
  return { id: "custom", rounded };
}

/** Wording for the visible "currently using" label. */
export function describeScale(bands: readonly GradeBand[]): string {
  const s = detectScale(bands);
  const base = s.id === "custom" ? `Custom (${bands.length} cutoff${bands.length === 1 ? "" : "s"})` : preset(s.id).name;
  return s.rounded ? `${base}, rounded to the nearest whole percent` : base;
}

/** Null when the table can be saved, else a teacher-readable reason. */
export function validateRows(rows: readonly CutoffRow[]): string | null {
  if (rows.length === 0) return "Add at least one grade.";
  if (rows.length > MAX_ROWS) return `Use at most ${MAX_ROWS} grades.`;
  for (const r of rows) {
    const t = r.label.trim();
    if (!t || t.length > MAX_LABEL) return `Every grade needs a name of 1 to ${MAX_LABEL} characters.`;
    if (!Number.isFinite(r.from) || r.from < 0 || r.from > 100) return "Each cutoff must be a number from 0 to 100.";
  }
  if (new Set(rows.map((r) => r.from)).size !== rows.length) return "Two grades start at the same percent. Each cutoff must be different.";
  if (!rows.some((r) => r.from === 0)) return "One grade must start at 0% so every student gets a grade.";
  return null;
}
