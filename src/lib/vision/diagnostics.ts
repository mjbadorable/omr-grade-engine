/**
 * Field-calibration diagnostics for real printed sheets: how each bubble is coloured on the
 * overlay, a numeric summary to compare batches, advice, and an exportable record.
 *
 * Ring colours (matches what the teacher sees):
 *   green  : FILLED with confidence > 0.75
 *   yellow : anything doubtful: PARTIAL, ERASURE, or FILLED with confidence ≤ 0.75
 *   red    : EMPTY
 */
import type { OMRTemplate } from "@/lib/omr/schema";
import { mmToCanonical } from "./geometry";
import type { ScanOutput } from "./scan-sheet";
import type { ScanTuning } from "./tuning";
import type { BubbleReadout, Vec2 } from "./types";

export const CONFIDENT_FILL = 0.75;
export type RingClass = "confident" | "warning" | "empty";

export const RING_STYLE: Record<RingClass, { color: string; label: string }> = {
  confident: { color: "rgba(22,163,74,.95)", label: "Filled, confident (> 0.75)" },
  warning: { color: "rgba(234,179,8,.98)", label: "Partial / erasure / low confidence" },
  empty: { color: "rgba(220,38,38,.55)", label: "Empty" },
};

export function ringClass(b: Pick<BubbleReadout, "state" | "confidence">): RingClass {
  if (b.state === "EMPTY") return "empty";
  if (b.state === "FILLED" && b.confidence > CONFIDENT_FILL) return "confident";
  return "warning";
}

export interface DiagnosticSummary {
  bubbles: number;
  confident: number;
  warning: number;
  empty: number;
  /** ids of the doubtful bubbles (yellow) */
  warningIds: string[];
  meanFilledDensity: number | null;
  meanEmptyDensity: number | null;
  /** filled − empty density: how clearly marks stand out on this sheet (higher is easier) */
  contrast: number | null;
  lowestFilledConfidence: number | null;
  markDetectRatio: number;
  maxCurlMm: number;
  missingMarks: number;
  aspectError: number;
  totalMs: number;
  advice: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);

export function summarize(result: Pick<ScanOutput, "bubbles" | "markDetectRatio" | "referenceMarks" | "corners" | "timingsMs">): DiagnosticSummary {
  const classes = result.bubbles.map((b) => ringClass(b));
  const filled = result.bubbles.filter((b) => b.state === "FILLED");
  const empty = result.bubbles.filter((b) => b.state === "EMPTY");
  const meanFilled = mean(filled.map((b) => b.density));
  const meanEmpty = mean(empty.map((b) => b.density));
  const contrast = meanFilled !== null && meanEmpty !== null ? meanFilled - meanEmpty : null;
  const warnings = result.bubbles.filter((_, i) => classes[i] === "warning");
  const s: DiagnosticSummary = {
    bubbles: result.bubbles.length,
    confident: classes.filter((c) => c === "confident").length,
    warning: warnings.length,
    empty: classes.filter((c) => c === "empty").length,
    warningIds: warnings.map((b) => b.bubbleId),
    meanFilledDensity: r3(meanFilled), meanEmptyDensity: r3(meanEmpty), contrast: r3(contrast),
    lowestFilledConfidence: filled.length ? Math.min(...filled.map((b) => b.confidence)) : null,
    markDetectRatio: result.markDetectRatio,
    maxCurlMm: Math.round(Math.max(0, ...result.referenceMarks.map((m) => m.offsetMm)) * 10) / 10,
    missingMarks: result.referenceMarks.filter((m) => !m.found).length,
    aspectError: Math.round(result.corners.aspectError * 1000) / 1000,
    totalMs: result.timingsMs.total ?? 0,
    advice: [],
  };
  s.advice = advise(s);
  return s;
}

/** Plain-language hints for the person running the calibration. */
export function advise(s: DiagnosticSummary): string[] {
  const out: string[] = [];
  if (s.bubbles && s.confident + s.warning === 0) out.push("No marks were read. Check the sheet is the right template, or lower the ink level (Faint #2 pencil preset).");
  const partial = s.warning;
  if (partial >= 3) out.push(`${partial} doubtful bubbles. If these are real answers drawn lightly, switch to the Faint #2 pencil preset; if they are smudges, use Dark ballpoint.`);
  if (s.contrast !== null && s.contrast < 0.25) out.push("Low contrast between marked and empty bubbles: improve lighting or use a darker pen/pencil.");
  if (s.markDetectRatio < 0.9) out.push(`Only ${Math.round(s.markDetectRatio * 100)}% of reference marks were found (${s.missingMarks} missing): the photo may be blurry, cropped or glared.`);
  if (s.maxCurlMm > 3) out.push(`Paper curl of ${s.maxCurlMm} mm was corrected; flatten the sheet for best accuracy.`);
  if (s.aspectError > 0.08) out.push("The sheet looks stretched: photograph it straight-on, filling the frame.");
  return out;
}

export interface OverlayGeometry {
  /** the 4 outer registration squares in canonical px, with their size */
  corners: { id: "tl" | "tr" | "br" | "bl"; center: Vec2; sizePx: number }[];
  /** anti-curl reference marks grouped by row (a "5-row band" boundary), detected positions left→right */
  bands: { row: number; marks: { detected: Vec2; expected: Vec2; found: boolean }[] }[];
}

export function overlayGeometry(template: OMRTemplate, result: Pick<ScanOutput, "pageIndex" | "canonical" | "referenceMarks">): OverlayGeometry {
  const page = template.pages[result.pageIndex] ?? template.pages[0];
  const f = page.fiducials;
  const px = (mm: [number, number]) => mmToCanonical(result.canonical, mm[0], mm[1]);
  const size = f.sizeMm * result.canonical.pxPerMm;
  const corners = (["tl", "tr", "br", "bl"] as const).map((id) => ({ id, center: px(f[id].center), sizePx: size }));
  const rows = new Map<number, OverlayGeometry["bands"][number]["marks"]>();
  for (const m of [...result.referenceMarks].sort((a, b) => a.col - b.col)) {
    const list = rows.get(m.row) ?? [];
    list.push({ detected: m.detected, expected: m.expected, found: m.found });
    rows.set(m.row, list);
  }
  return { corners, bands: [...rows].sort((a, b) => a[0] - b[0]).map(([row, marks]) => ({ row, marks })) };
}

export interface DiagnosticExport {
  schema: "omr-diagnostic/v1";
  exportedAt: string;
  template: { templateId: string; version: number; layoutHash: string };
  tuning: ScanTuning;
  device: { userAgent: string; viewport: string };
  summary: DiagnosticSummary;
  /** per-bubble readings, so a batch can be re-analysed offline */
  bubbles: { id: string; state: string; density: number; coverage: number; confidence: number }[];
  warnings: string[];
}

export function buildDiagnosticExport(template: OMRTemplate, result: ScanOutput, tuning: ScanTuning, env: { userAgent?: string; viewport?: string; now?: Date } = {}): DiagnosticExport {
  return {
    schema: "omr-diagnostic/v1",
    exportedAt: (env.now ?? new Date()).toISOString(),
    template: { templateId: template.templateId, version: template.version, layoutHash: template.layoutHash },
    tuning,
    device: { userAgent: env.userAgent ?? "", viewport: env.viewport ?? "" },
    summary: summarize(result),
    bubbles: result.bubbles.map((b) => ({ id: b.bubbleId, state: b.state, density: b.density, coverage: b.coverage, confidence: b.confidence })),
    warnings: result.warnings,
  };
}
