/**
 * Live camera guardrails (pre-capture). Pure functions over a small downsampled RGBA frame so
 * they cost ~0.2 ms and are unit-testable; the camera panel samples a 160-px-wide canvas.
 *
 *   Too dark : mean luminance is low (underexposed marks cannot be told from the paper)
 *   Glare    : a clipped specular highlight on a frame that is otherwise not blown out, or a
 *              registration square whose neighbourhood has lost its black (washed out). A uniformly
 *              bright white sheet is NOT glare: its marks are still dark.
 *   Steady   : the 4 detected corners moved less than JITTER_MAX of the quad diagonal for
 *              STABLE_FRAMES consecutive frames
 * Thresholds are exported so the field-calibration notes can quote them and be retuned.
 */
import type { CornerPoints, Vec2 } from "./types";

export const QUALITY = {
  DARK_MEAN_LUMA: 70,          // 0..255
  GLARE_SATURATED: 0.04,       // share of pixels clipped (all channels ≥ 250) that counts as a highlight …
  GLARE_MAX_MEDIAN: 225,       // … unless the whole frame is bright paper (then it is just a white sheet)
  OVEREXPOSED_SATURATED: 0.5,  // informational: most of the frame is clipped (white paper often is; only washed-out marks count as glare)
  MARK_WASHOUT_LUMA: 120,      // a black fiducial whose darkest nearby pixel is lighter than this is washed out
  JITTER_MAX: 0.012,           // fraction of the quad diagonal per frame
  STABLE_FRAMES: 4,
} as const;

export const MESSAGES = {
  dark: "Too Dark — Move to brighter light or turn on torch",
  glare: "Glare Detected — Tilt phone slightly",
  steady: "Hold Steady — Align all 4 corners",
} as const;

export interface FrameQuality { meanLuma: number; medianLuma: number; saturatedFraction: number; dark: boolean; glare: boolean; overexposed: boolean; washedOutCorners: number }

const luma = (d: Uint8ClampedArray | Uint8Array, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** `corners`, when known, are in the same pixel space as `rgba` (width × height). */
export function analyzeFrame(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, corners?: readonly Vec2[] | null): FrameQuality {
  const n = width * height;
  const hist = new Uint32Array(256);
  let sum = 0, sat = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const l = luma(rgba, i);
    sum += l; hist[Math.min(255, Math.round(l))]++;
    if (rgba[i] >= 250 && rgba[i + 1] >= 250 && rgba[i + 2] >= 250) sat++;
  }
  const mean = n ? sum / n : 0;
  let acc = 0, median = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { median = v; break; } }
  const saturatedFraction = n ? sat / n : 0;

  let washed = 0;
  if (corners?.length) {
    const r = Math.max(2, Math.round(width * 0.03));
    for (const c of corners) {
      let darkest = 255;
      for (let y = Math.max(0, Math.round(c.y) - r); y <= Math.min(height - 1, Math.round(c.y) + r); y++)
        for (let x = Math.max(0, Math.round(c.x) - r); x <= Math.min(width - 1, Math.round(c.x) + r); x++)
          darkest = Math.min(darkest, luma(rgba, (y * width + x) * 4));
      if (darkest > QUALITY.MARK_WASHOUT_LUMA) washed++;
    }
  }
  const overexposed = saturatedFraction >= QUALITY.OVEREXPOSED_SATURATED;
  return {
    meanLuma: Math.round(mean * 10) / 10, medianLuma: median, saturatedFraction: Math.round(saturatedFraction * 1000) / 1000,
    dark: mean < QUALITY.DARK_MEAN_LUMA,
    glare: washed > 0 || (saturatedFraction >= QUALITY.GLARE_SATURATED && median <= QUALITY.GLARE_MAX_MEDIAN),
    overexposed, washedOutCorners: washed,
  };
}

export interface StabilityState { aligned: boolean; stable: boolean; streak: number; jitter: number | null }

/** Tracks corner movement across frames. */
export class StabilityTracker {
  private prev: Vec2[] | null = null;
  private streak = 0;
  push(c: Pick<CornerPoints, "tl" | "tr" | "br" | "bl"> | null): StabilityState {
    if (!c) { this.prev = null; this.streak = 0; return { aligned: false, stable: false, streak: 0, jitter: null }; }
    const pts = [c.tl, c.tr, c.br, c.bl];
    const diag = Math.hypot(c.br.x - c.tl.x, c.br.y - c.tl.y) || 1;
    let jitter: number | null = null;
    if (this.prev) {
      jitter = Math.max(...pts.map((p, i) => Math.hypot(p.x - this.prev![i].x, p.y - this.prev![i].y))) / diag;
      this.streak = jitter <= QUALITY.JITTER_MAX ? this.streak + 1 : 0;
    } else this.streak = 0;
    this.prev = pts;
    return { aligned: true, stable: this.streak >= QUALITY.STABLE_FRAMES, streak: this.streak, jitter: jitter === null ? null : Math.round(jitter * 10000) / 10000 };
  }
  reset() { this.prev = null; this.streak = 0; }
}

export interface Guidance { ok: boolean; /** most important first */ issues: ("dark" | "glare" | "steady")[]; messages: string[] }

/** Combine quality + stability into the messages shown on the viewfinder (dark > glare > steady). */
export function guidance(q: FrameQuality | null, s: StabilityState | null): Guidance {
  const issues: Guidance["issues"] = [];
  if (q?.dark) issues.push("dark");
  if (q?.glare && !q.dark) issues.push("glare");
  if (!s || !s.aligned || !s.stable) issues.push("steady");
  return { ok: issues.length === 0, issues, messages: issues.map((i) => MESSAGES[i]) };
}
