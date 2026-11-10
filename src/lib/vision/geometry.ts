/**
 * Pure geometry: homographies, quad validation and template↔canonical mapping.
 * No OpenCV dependency, so every function here is unit-testable with exact numbers.
 */
import type { OMRTemplate } from "@/lib/omr/schema";
import { type CornerPoints, type Mat3, type Vec2, VisionError } from "./types";

/** Canonical margin around the fiducial centres so fiducials and footer stay inside the image. */
export const CANONICAL_PAD_MM = 6;
export const DEFAULT_PX_PER_MM = 5;

export interface CanonicalFrame { widthPx: number; heightPx: number; pxPerMm: number; padMm: number }

export function canonicalFrame(t: OMRTemplate, pxPerMm = DEFAULT_PX_PER_MM): CanonicalFrame {
  return {
    widthPx: Math.round((t.sheet.widthMm + 2 * CANONICAL_PAD_MM) * pxPerMm),
    heightPx: Math.round((t.sheet.heightMm + 2 * CANONICAL_PAD_MM) * pxPerMm),
    pxPerMm,
    padMm: CANONICAL_PAD_MM,
  };
}

/** template mm → canonical px under the ideal (global) warp. */
export function mmToCanonical(f: CanonicalFrame, x: number, y: number): Vec2 {
  return { x: (x + f.padMm) * f.pxPerMm, y: (y + f.padMm) * f.pxPerMm };
}

// ------------------------------------------------------------------ homography
/**
 * Solve the 4-point homography H with H·src_i ∝ dst_i (DLT with h33 = 1), via Gaussian
 * elimination with partial pivoting on the 8×8 system.
 */
export function homographyFrom4(src: readonly Vec2[], dst: readonly Vec2[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new VisionError("INTERNAL", "homography needs exactly 4 point pairs");
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new VisionError("INTERNAL", "degenerate point configuration (collinear points)");
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f !== 0) for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[n] / row[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(H: Mat3, p: Vec2): Vec2 {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new VisionError("INTERNAL", "singular matrix");
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ].map((v) => v / det);
  const s = inv[8];
  return inv.map((v) => v / s) as unknown as Mat3;
}

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

// ------------------------------------------------------------------ corner validation
const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Strictly convex, consistently wound quad TL→TR→BR→BL (clockwise in y-down image coords). */
export function isConvexQuad(tl: Vec2, tr: Vec2, br: Vec2, bl: Vec2): boolean {
  const q = [tl, tr, br, bl];
  for (let i = 0; i < 4; i++) if (cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) <= 0) return false;
  return true;
}

export function quadArea(tl: Vec2, tr: Vec2, br: Vec2, bl: Vec2): number {
  const q = [tl, tr, br, bl];
  let s = 0;
  for (let i = 0; i < 4; i++) s += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y;
  return Math.abs(s) / 2;
}

/**
 * Order four arbitrary candidate centres into TL/TR/BR/BL (sum/difference extremes) and
 * validate them against the template's fiducial geometry.
 *
 * @param aspectTolerance max |measured/expected − 1| (perspective foreshortening allowance)
 * @param minAreaFraction quad must cover at least this fraction of the image
 */
export function validateCorners(
  pts: readonly Vec2[],
  expectedAspect: number,
  imageSize: { width: number; height: number },
  { aspectTolerance = 0.3, minAreaFraction = 0.08 } = {},
): CornerPoints {
  if (pts.length !== 4) throw new VisionError("CORNERS_NOT_FOUND", `expected 4 fiducials, found ${pts.length}`);
  const by = (f: (p: Vec2) => number) => [...pts].sort((a, b) => f(a) - f(b));
  const tl = by((p) => p.x + p.y)[0];
  const br = by((p) => -(p.x + p.y))[0];
  const tr = by((p) => p.y - p.x)[0];
  const bl = by((p) => p.x - p.y)[0];
  if (new Set([tl, tr, br, bl]).size !== 4)
    throw new VisionError("CORNERS_INVALID", "fiducials do not form four distinct corners");
  if (!isConvexQuad(tl, tr, br, bl))
    throw new VisionError("CORNERS_INVALID", "fiducial quadrilateral is not convex");
  const area = quadArea(tl, tr, br, bl);
  if (area < minAreaFraction * imageSize.width * imageSize.height)
    throw new VisionError("CORNERS_INVALID", "sheet is too small in the frame; move closer", { areaFraction: area / (imageSize.width * imageSize.height) });
  const w = (dist(tl, tr) + dist(bl, br)) / 2;
  const h = (dist(tl, bl) + dist(tr, br)) / 2;
  const aspectRatio = w / h;
  const aspectError = aspectRatio / expectedAspect;
  if (Math.abs(aspectError - 1) > aspectTolerance)
    throw new VisionError("CORNERS_INVALID", `fiducial aspect ${aspectRatio.toFixed(3)} does not match template ${expectedAspect.toFixed(3)}`, { aspectRatio, expectedAspect });
  return { tl, tr, bl, br, aspectRatio, aspectError };
}
