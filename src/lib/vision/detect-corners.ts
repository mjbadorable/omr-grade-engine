/**
 * Fiducial anchor search + global perspective warp into canonical template space.
 *
 * Candidate test (per outer contour from RETR_CCOMP):
 *   - area within a frame-relative band
 *   - rotated bounding box (minAreaRect) aspect within 0.75 – 1.25 (both orientations)
 *   - fill ratio contourArea / rectArea ≥ 0.78  (small blurred squares measure ≈ 0.84)
 *   - approxPolyDP (ε = 6 % of perimeter) gives a convex 4-gon → rejects filled circles
 *   - holes (CCOMP children) ≤ 12 % of area     → rejects write-boxes and QR finder rings
 * Selection: the largest candidates are tried in combinations until four of them pass
 * `validateCorners` (convex, plausible aspect, big enough), so a stray dark square on the
 * desk does not break detection.
 */
import type { OMRTemplate } from "@/lib/omr/schema";
import type { CV, Mat } from "./cv";
import { type CanonicalFrame, mmToCanonical, validateCorners } from "./geometry";
import { fiducialBinary } from "./normalize";
import { type CornerPoints, type Mat3, type Vec2, VisionError } from "./types";

export interface FiducialCandidate { center: Vec2; area: number; aspect: number; fill: number; holeRatio: number }

export const CANDIDATE_RULES = { minAspect: 0.75, maxAspect: 1.25, minFill: 0.78, maxHoleRatio: 0.12 } as const;

function isConvexQuadrilateral(cv: CV, contour: Mat): boolean {
  const approx = new cv.Mat();
  try {
    cv.approxPolyDP(contour, approx, 0.06 * cv.arcLength(contour, true), true);
    return approx.rows === 4 && cv.isContourConvex(approx);
  } finally {
    approx.delete();
  }
}

export function findFiducialCandidates(cv: CV, binary: Mat): FiducialCandidate[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const out: FiducialCandidate[] = [];
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
    const H = hierarchy.data32S; // [next, prev, firstChild, parent] per contour
    const imgArea = binary.cols * binary.rows;
    const long = Math.max(binary.cols, binary.rows);
    const minArea = Math.max(36, (long * 0.004) ** 2);
    const maxArea = imgArea * 0.01;
    const n = contours.size();
    for (let i = 0; i < n; i++) {
      if (H[i * 4 + 3] !== -1) continue; // holes are handled through their parent
      const c = contours.get(i);
      try {
        const area = cv.contourArea(c);
        if (area < minArea || area > maxArea) continue;
        let holes = 0;
        for (let ch = H[i * 4 + 2]; ch !== -1; ch = H[ch * 4]) {
          const hc = contours.get(ch);
          holes += cv.contourArea(hc);
          hc.delete();
        }
        const holeRatio = holes / area;
        if (holeRatio > CANDIDATE_RULES.maxHoleRatio) continue;
        const rr = cv.minAreaRect(c);
        const w = rr.size.width, h = rr.size.height;
        if (w <= 0 || h <= 0) continue;
        const aspect = w / h;
        const inBand = (a: number) => a >= CANDIDATE_RULES.minAspect && a <= CANDIDATE_RULES.maxAspect;
        if (!inBand(aspect) && !inBand(1 / aspect)) continue; // minAreaRect w/h order is arbitrary
        const fill = area / (w * h);
        if (fill < CANDIDATE_RULES.minFill) continue;
        if (!isConvexQuadrilateral(cv, c)) continue;
        const m = cv.moments(c, false);
        if (m.m00 === 0) continue;
        out.push({ center: { x: m.m10 / m.m00, y: m.m01 / m.m00 }, area, aspect, fill, holeRatio });
      } finally {
        c.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return out.sort((a, b) => b.area - a.area);
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}

/** Pick 4 fiducials from candidates (largest first, ≤ 8 candidates → ≤ 70 combinations). */
export function selectCorners(cands: FiducialCandidate[], expectedAspect: number, size: { width: number; height: number }): CornerPoints {
  if (cands.length < 4) throw new VisionError("CORNERS_NOT_FOUND", `found ${cands.length} of 4 corner markers`, { candidates: cands.length });
  const pool = cands.slice(0, 8);
  let lastErr: unknown = null;
  let best: { corners: CornerPoints; score: number } | null = null;
  for (const combo of combinations(pool, 4)) {
    const areas = combo.map((c) => c.area);
    if (Math.min(...areas) < 0.3 * Math.max(...areas)) continue; // fiducials share one size (± perspective)
    try {
      const corners = validateCorners(combo.map((c) => c.center), expectedAspect, size);
      // prefer the largest quad with the best aspect agreement
      const score = Math.abs(corners.aspectError - 1) - 1e-9 * areas.reduce((a, b) => a + b, 0);
      if (!best || score < best.score) best = { corners, score };
    } catch (e) {
      lastErr = e;
    }
  }
  if (best) return best.corners;
  if (lastErr instanceof VisionError) throw lastErr;
  throw new VisionError("CORNERS_NOT_FOUND", "no four candidates form a valid sheet");
}

export interface CornerDetection { corners: CornerPoints; candidates: number }

export function detectCorners(cv: CV, gray: Mat, template: OMRTemplate): CornerDetection {
  const bin = fiducialBinary(cv, gray);
  try {
    const cands = findFiducialCandidates(cv, bin);
    const corners = selectCorners(cands, template.sheet.widthMm / template.sheet.heightMm, { width: gray.cols, height: gray.rows });
    return { corners, candidates: cands.length };
  } finally {
    bin.delete();
  }
}

export interface CanonicalWarp { canonical: Mat; matrix: Mat3 }

/** getPerspectiveTransform + warpPerspective: image px → canonical px. */
export function warpToCanonical(cv: CV, gray: Mat, corners: CornerPoints, frame: CanonicalFrame, template: OMRTemplate): CanonicalWarp {
  const f = template.pages[0].fiducials;
  const dst = [f.tl, f.tr, f.br, f.bl].map((m) => mmToCanonical(frame, m.center[0], m.center[1]));
  const srcPts = [corners.tl, corners.tr, corners.br, corners.bl];
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, srcPts.flatMap((p) => [p.x, p.y]));
  const dstM = cv.matFromArray(4, 1, cv.CV_32FC2, dst.flatMap((p) => [p.x, p.y]));
  const M = cv.getPerspectiveTransform(src, dstM);
  const canonical = new cv.Mat();
  try {
    cv.warpPerspective(gray, canonical, M, new cv.Size(frame.widthPx, frame.heightPx), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    const d = M.data64F;
    const matrix = [d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8]].map((v) => v / d[8]) as unknown as Mat3;
    return { canonical, matrix };
  } catch (e) {
    canonical.delete();
    throw e;
  } finally {
    src.delete(); dstM.delete(); M.delete();
  }
}
