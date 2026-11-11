import type { ScoredSheet } from "@/lib/grading/types";

export interface Standing { rank: number; percentile: number }

/**
 * Competition ranking ("1, 2, 2, 4") on totalScore and percentile rank
 * PR = 100 · (below + ½·equal) / N.
 */
export function computeClassStanding(sheets: readonly Pick<ScoredSheet, "sheetId" | "totalScore">[]): Map<string, Standing> {
  const n = sheets.length;
  const scores = sheets.map((s) => s.totalScore).sort((a, b) => a - b);
  const out = new Map<string, Standing>();
  for (const s of sheets) {
    let below = 0, equal = 0;
    for (const x of scores) { if (x < s.totalScore) below++; else if (x === s.totalScore) equal++; }
    const higher = n - below - equal;
    out.set(s.sheetId, { rank: higher + 1, percentile: Math.round((1000 * (below + 0.5 * equal)) / n) / 10 });
  }
  return out;
}
