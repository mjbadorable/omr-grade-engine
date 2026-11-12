/** Per-question answer distribution for the Item Analysis view: A, B, C, D … and Blank, with counts and shares. */
import type { ItemStatistics } from "./types";

export const HIGH_DISTRACTOR = 0.3;   // a wrong option chosen by more than 30 % of students is a red flag
export const VERY_HIGH_DISTRACTOR = 0.5;

export type DistLevel = "key" | "ok" | "warn" | "high" | "blank";
export interface DistRow { label: string; count: number; pct: number; isKey: boolean; blank: boolean; level: DistLevel }

export function distributionRows(item: Pick<ItemStatistics, "n" | "omitted" | "distractors">): DistRow[] {
  const n = Math.max(1, item.n);
  const rows: DistRow[] = item.distractors.map((d) => {
    const pct = d.count / n;
    const level: DistLevel = d.isKey ? "key" : pct > VERY_HIGH_DISTRACTOR ? "high" : pct > HIGH_DISTRACTOR ? "warn" : "ok";
    return { label: d.label, count: d.count, pct, isKey: d.isKey, blank: false, level };
  });
  rows.push({ label: "Blank", count: item.omitted, pct: item.omitted / n, isKey: false, blank: true, level: "blank" });
  return rows;
}

/** Most-chosen wrong option, if it passes the 30 % threshold. */
export const dominantDistractor = (rows: readonly DistRow[]): DistRow | null =>
  rows.filter((r) => !r.isKey && !r.blank && r.pct > HIGH_DISTRACTOR).sort((a, b) => b.pct - a.pct)[0] ?? null;
