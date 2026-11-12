/**
 * Scanner sensitivity ("Scanner Calibration" drawer). The shipped defaults are the tuned baseline
 * for dark marks; a batch filled with faint #2 pencil needs a lower ink level so light graphite
 * still counts as ink, and a pen batch can use a stricter one.
 *
 *   inkLevel      0..255  background-normalised darkness counted as ink (lower = more sensitive)
 *   fillCoverage  0..1    share of the bubble's inner disc that must be ink to call it FILLED
 */
import { THRESHOLDS, type Thresholds } from "./read-bubbles";

export interface ScanTuning { inkLevel: number; fillCoverage: number }

export const DEFAULT_TUNING: ScanTuning = { inkLevel: THRESHOLDS.INK_LEVEL, fillCoverage: THRESHOLDS.FILL_COVERAGE };
export const TUNING_LIMITS = { inkLevel: { min: 40, max: 200, step: 1 }, fillCoverage: { min: 0.4, max: 0.95, step: 0.01 } } as const;

export const TUNING_PRESETS: readonly { id: string; label: string; hint: string; tuning: ScanTuning }[] = [
  { id: "baseline", label: "Baseline", hint: "Tuned default: dark pen or firm pencil", tuning: DEFAULT_TUNING },
  { id: "pencil", label: "Faint #2 pencil", hint: "Light graphite: counts fainter marks as ink", tuning: { inkLevel: 85, fillCoverage: 0.7 } },
  { id: "pen", label: "Dark ballpoint", hint: "Stricter: ignores smudges and light ghosting", tuning: { inkLevel: 150, fillCoverage: 0.8 } },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fill in defaults and clamp to the supported range (stored / hand-edited values are never trusted). */
export function normalizeTuning(t: Partial<ScanTuning> | null | undefined): ScanTuning {
  const L = TUNING_LIMITS;
  const ink = Number.isFinite(t?.inkLevel) ? (t!.inkLevel as number) : DEFAULT_TUNING.inkLevel;
  const cov = Number.isFinite(t?.fillCoverage) ? (t!.fillCoverage as number) : DEFAULT_TUNING.fillCoverage;
  return { inkLevel: Math.round(clamp(ink, L.inkLevel.min, L.inkLevel.max)), fillCoverage: Math.round(clamp(cov, L.fillCoverage.min, L.fillCoverage.max) * 100) / 100 };
}

export const isDefaultTuning = (t: ScanTuning) => t.inkLevel === DEFAULT_TUNING.inkLevel && t.fillCoverage === DEFAULT_TUNING.fillCoverage;

/** Full threshold set for the classifier; PARTIAL stays below FILL so the bands never overlap. */
export function thresholdsFor(t: Partial<ScanTuning> | null | undefined): Thresholds {
  const n = normalizeTuning(t);
  return { ...THRESHOLDS, INK_LEVEL: n.inkLevel, FILL_COVERAGE: n.fillCoverage, PARTIAL_COVERAGE: Math.min(THRESHOLDS.PARTIAL_COVERAGE, n.fillCoverage - 0.1) };
}

const KEY = "omr:scanTuning";
export function readStoredTuning(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): ScanTuning {
  try { return normalizeTuning(JSON.parse(storage?.getItem(KEY) ?? "null")); } catch { return DEFAULT_TUNING; }
}
export function writeStoredTuning(t: ScanTuning, storage: Pick<Storage, "setItem" | "removeItem"> | null = typeof localStorage === "undefined" ? null : localStorage) {
  try { if (isDefaultTuning(t)) storage?.removeItem(KEY); else storage?.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ }
}
