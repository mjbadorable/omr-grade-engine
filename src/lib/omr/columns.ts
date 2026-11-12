/**
 * Answer-column safety. Each column must be wide enough for its question number plus every
 * option bubble, so the number of columns that fit depends on the paper width and the option count.
 * Limits (A4 width; Letter uses the same, slightly conservative, table):
 *   2–4 options (A–D) → 4 columns · 5 options (A–E) → 3 columns · 6 options (A–F) → 2 columns
 * Compact bubbles (≤ 3.8 mm, e.g. the 200-question preset) are narrower, so one more column fits.
 * The COLUMN_OVERLAP check in the layout validator is the safety net behind these caps.
 */
import type { LayoutSettings } from "./schema";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export const clampOptions = (n: number) => Math.min(MAX_OPTIONS, Math.max(MIN_OPTIONS, Math.round(Number.isFinite(n) ? n : 4)));

/** Most answer columns that cannot touch horizontally for a section with `optionCount` choices. */
export const COMPACT_BUBBLE_MM = 3.8;
export function maxColumnsForOptions(optionCount: number, bubbleMm = 4.2): number {
  const n = clampOptions(optionCount);
  const base = n <= 4 ? 4 : n === 5 ? 3 : 2;
  return bubbleMm <= COMPACT_BUBBLE_MM ? base + 1 : base;
}

/** Safe column cap for the whole sheet: the tightest multiple-choice section decides. */
export function safeColumnLimit(s: Pick<LayoutSettings, "sections"> & { bubbleDiameterMm?: number }): number {
  const mcq = s.sections.filter((x) => x.type === "mcq").map((x) => (x.type === "mcq" ? x.optionCount : 4));
  return mcq.length ? Math.min(...mcq.map((n) => maxColumnsForOptions(n, s.bubbleDiameterMm))) : 6;
}

/** Why a given column count is unavailable (for the disabled menu entries), or null when allowed. */
export function columnBlockedReason(s: Pick<LayoutSettings, "sections"> & { bubbleDiameterMm?: number }, columns: number): string | null {
  const limit = safeColumnLimit(s);
  if (columns <= limit) return null;
  const widest = Math.max(...s.sections.map((x) => (x.type === "mcq" ? x.optionCount : 0)));
  return `too wide for ${widest} choices (A–${String.fromCharCode(64 + widest)})`;
}

/**
 * Bring settings into the supported range: 2–6 options per multiple-choice section, and no more
 * answer columns than fit without touching. Returns the same object when nothing changes.
 */
export function normalizeSettings(s: LayoutSettings): LayoutSettings {
  let changed = false;
  const sections = s.sections.map((x) => {
    if (x.type !== "mcq") return x;
    const optionCount = x.optionStyle === "true-false" ? 2 : clampOptions(x.optionCount);
    if (optionCount === x.optionCount) return x;
    changed = true;
    return { ...x, optionCount };
  });
  const withSections = changed ? { ...s, sections } : s;
  const limit = safeColumnLimit(withSections);
  if (withSections.columns > limit) return { ...withSections, columns: limit };
  return withSections;
}
