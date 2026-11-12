/**
 * Continuous density sampling (replaces EvalBee's 9-point binary vote).
 *
 * For each bubble: map its template centre through its cell homography, then sample every
 * pixel of the inner disc (radius = innerSampleRatio × d/2) of the background-normalised
 * darkness map:
 *   density  = mean darkness (0..1)
 *   coverage = share of pixels darker than INK_LEVEL
 * Classification is relative to the bubble's group (question / roll column / set row):
 *   adjusted = (density − baseline) / (1 − baseline), baseline = lightest option in the group (capped near the sheet baseline)
 *   FILLED   coverage ≥ FILL_COVERAGE                 (solid mark)
 *   PARTIAL  coverage ≥ PARTIAL_COVERAGE              (part of the disc solidly marked)
 *   ERASURE  adjusted ≥ ERASURE_DENSITY, low coverage (diffuse grey residue)
 *   EMPTY    otherwise
 */
import type { OMRPage, OMRTemplate } from "@/lib/omr/schema";
import type { Mat } from "./cv";
import { applyHomography, type CanonicalFrame } from "./geometry";
import type { BubbleField, BubbleReadout, BubbleState, CellTransform, Vec2 } from "./types";

export const THRESHOLDS = {
  INK_LEVEL: 128,          // darkness 0..255 counted as ink (printed labels ≈ 95)
  FILL_COVERAGE: 0.75,     // solid fills ≈ 1.0; half-filled discs ≈ 0.55
  PARTIAL_COVERAGE: 0.15,
  ERASURE_DENSITY: 0.1,
  BASELINE_SLACK: 0.08,    // a group's baseline may not exceed the sheet baseline by more
} as const;

/** Decision thresholds as plain numbers (the field-calibration drawer tunes INK_LEVEL and FILL_COVERAGE). */
export type Thresholds = { -readonly [K in keyof typeof THRESHOLDS]: number };

export interface DiskSample { density: number; coverage: number; n: number }

/** Mean darkness and ink coverage over a disc of radius r (px) centred at (cx, cy). */
export function sampleDisk(data: Uint8Array | Uint8ClampedArray, width: number, height: number, cx: number, cy: number, r: number, inkLevel: number = THRESHOLDS.INK_LEVEL): DiskSample {
  const r2 = r * r;
  let sum = 0, ink = 0, n = 0;
  const y0 = Math.max(0, Math.ceil(cy - r)), y1 = Math.min(height - 1, Math.floor(cy + r));
  const x0 = Math.max(0, Math.ceil(cx - r)), x1 = Math.min(width - 1, Math.floor(cx + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy, row = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      const v = data[row + x];
      sum += v;
      if (v >= inkLevel) ink++;
      n++;
    }
  }
  return n ? { density: sum / n / 255, coverage: ink / n, n } : { density: 0, coverage: 0, n: 0 };
}

/** Sheet-level empty baseline: median density of the lowest third of all bubbles. */
export function sheetBaseline(densities: number[]): number {
  if (!densities.length) return 0;
  const s = [...densities].sort((a, b) => a - b);
  const third = s.slice(0, Math.max(1, Math.ceil(s.length / 3)));
  return third[Math.floor(third.length / 2)];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export interface Classified { state: BubbleState; confidence: number; adjustedDensity: number }

export function classifyGroup(samples: DiskSample[], sheetBase: number, T: Thresholds = THRESHOLDS): Classified[] {
  const groupMin = Math.min(...samples.map((s) => s.density));
  const base = Math.min(groupMin, sheetBase + T.BASELINE_SLACK);
  return samples.map((s) => {
    const adj = clamp01((s.density - base) / Math.max(1e-6, 1 - base));
    const c = s.coverage;
    if (c >= T.FILL_COVERAGE) return { state: "FILLED", adjustedDensity: adj, confidence: clamp01(0.5 + (c - T.FILL_COVERAGE) / 0.25) };
    if (c >= T.PARTIAL_COVERAGE) {
      const m = Math.min(c - T.PARTIAL_COVERAGE, T.FILL_COVERAGE - c);
      return { state: "PARTIAL", adjustedDensity: adj, confidence: clamp01(0.5 + m / 0.4) };
    }
    if (adj >= T.ERASURE_DENSITY) {
      const m = Math.min(adj - T.ERASURE_DENSITY, T.PARTIAL_COVERAGE - c);
      return { state: "ERASURE", adjustedDensity: adj, confidence: clamp01(0.5 + m / 0.2) };
    }
    const m = Math.min(T.ERASURE_DENSITY - adj, T.PARTIAL_COVERAGE - c);
    return { state: "EMPTY", adjustedDensity: adj, confidence: clamp01(0.5 + m / 0.2) };
  });
}

// ------------------------------------------------------------------ template traversal
export interface BubbleRef { id: string; field: BubbleField; questionIndex: number; optionIndex: number; groupKey: string; centerMm: [number, number]; cell: [number, number] }

/** Every bubble on a page with its group key (the unit of mutually-exclusive choice). */
export function bubbleRefs(page: OMRPage): BubbleRef[] {
  const refs: BubbleRef[] = [];
  const push = (b: { id: string; center: [number, number]; cell: [number, number] }, field: BubbleField, q: number, o: number, group: string) =>
    refs.push({ id: b.id, field, questionIndex: q, optionIndex: o, groupKey: group, centerMm: b.center, cell: b.cell });
  for (const r of page.regions) {
    if (r.kind === "mcq") for (const q of r.questions) q.bubbles.forEach((b, o) => push(b, "answer", q.number - 1, o, `q${q.number}`));
    else if (r.kind === "roll") r.columns.forEach((col, d) => col.forEach((b, s) => push(b, "roll", d, s, `roll${d}`)));
    else if (r.kind === "set") r.bubbles.forEach((b, o) => push(b, "set", 0, o, "set"));
    else if (r.kind === "numeric") {
      const q = r.questionNumber - 1;
      r.columns.forEach((col, d) => col.forEach((b, v) => push(b, "numeric", q, d * 10 + v, `n${r.questionNumber}:d${d}`)));
      r.decimalBubbles.forEach((b, d) => push(b, "numeric", q, 100 + d, `n${r.questionNumber}:dot`));
      if (r.signBubble) push(r.signBubble, "numeric", q, 200, `n${r.questionNumber}:sign`);
    } else if (r.kind === "matrix") {
      r.cells.forEach((row, ri) => row.forEach((b, ci) => push(b, "matrix", r.questionNumber - 1, ri * r.cols.length + ci, `m${r.questionNumber}:r${ri}`)));
    }
  }
  return refs;
}

export function cellLookup(cells: CellTransform[]) {
  const map = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  return (row: number, col: number) => {
    const t = map.get(`${row}:${col}`);
    if (!t) throw new Error(`no transform for cell ${row}:${col}`);
    return t;
  };
}

/** Read every bubble of `page` from a canonical darkness map (8-bit, 0 = paper). */
export function readBubbles(darkness: Mat, page: OMRPage, template: OMRTemplate, cells: CellTransform[], frame: CanonicalFrame, T: Thresholds = THRESHOLDS): BubbleReadout[] {
  const refs = bubbleRefs(page);
  const cellOf = cellLookup(cells);
  const r = template.bubble.innerSampleRatio * (template.bubble.diameterMm / 2) * frame.pxPerMm;
  const data = darkness.data as Uint8Array;
  const samples = refs.map((ref) => {
    const center: Vec2 = applyHomography(cellOf(ref.cell[0], ref.cell[1]).matrix, { x: ref.centerMm[0], y: ref.centerMm[1] });
    return { ref, center, s: sampleDisk(data, darkness.cols, darkness.rows, center.x, center.y, r, T.INK_LEVEL) };
  });
  const base = sheetBaseline(samples.map((x) => x.s.density));
  const groups = new Map<string, typeof samples>();
  for (const x of samples) (groups.get(x.ref.groupKey) ?? groups.set(x.ref.groupKey, []).get(x.ref.groupKey)!).push(x);

  const out: BubbleReadout[] = [];
  for (const g of groups.values()) {
    const cls = classifyGroup(g.map((x) => x.s), base, T);
    g.forEach((x, i) => out.push({
      questionIndex: x.ref.questionIndex,
      optionIndex: x.ref.optionIndex,
      density: round(x.s.density),
      state: cls[i].state,
      confidence: round(cls[i].confidence),
      bubbleId: x.ref.id,
      field: x.ref.field,
      coverage: round(x.s.coverage),
      adjustedDensity: round(cls[i].adjustedDensity),
      center: { x: round(x.center.x, 2), y: round(x.center.y, 2) },
    }));
  }
  return out;
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
