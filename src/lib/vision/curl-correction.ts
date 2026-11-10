/**
 * Piecewise homography (curl correction) — same idea as EvalBee chunk 6875 §3.3–3.4, with
 * explicit mark centres from our Sprint 1 template instead of inferred pixel grids.
 *
 * 1. refineReferenceMarks: around each reference mark's ideal canonical position, find the
 *    solid square in the darkness map and take its moment centroid (sub-pixel).
 * 2. buildCellTransforms: for every grid cell (one 5-row band × column span) solve the
 *    4-point homography template-mm → canonical-px from the cell's four detected marks.
 * Bubbles are then mapped through their own cell's matrix (bubble.cell), so local paper
 * curl, desk tilt and lens distortion are absorbed band by band.
 */
import type { OMRPage } from "@/lib/omr/schema";
import type { CV, Mat } from "./cv";
import { type CanonicalFrame, homographyFrom4, mmToCanonical } from "./geometry";
import { type CellTransform, type ReferenceMarkReadout, type Vec2, VisionError } from "./types";

export const MARK_SEARCH_RADIUS_MM = 4.5;

interface Blob { center: Vec2; area: number }

function findSquareBlobs(cv: CV, roiBin: Mat): Blob[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const blobs: Blob[] = [];
  try {
    cv.findContours(roiBin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = cv.contourArea(c);
        if (area < 4) continue;
        const rr = cv.minAreaRect(c);
        const { width: w, height: h } = rr.size;
        const r = Math.min(w, h) / Math.max(w, h);
        if (r < 0.6 || area / (w * h) < 0.82) continue; // squares ≈ 1.0, filled bubbles ≈ π/4
        const m = cv.moments(c, false);
        if (m.m00 > 0) blobs.push({ center: { x: m.m10 / m.m00, y: m.m01 / m.m00 }, area });
      } finally {
        c.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return blobs;
}

export function refineReferenceMarks(cv: CV, darkness: Mat, page: OMRPage, frame: CanonicalFrame): ReferenceMarkReadout[] {
  const g = page.referenceGrid;
  const out: ReferenceMarkReadout[] = [];
  const bin = new cv.Mat();
  try {
    cv.threshold(darkness, bin, 110, 255, cv.THRESH_BINARY);
    const R = Math.round(MARK_SEARCH_RADIUS_MM * frame.pxPerMm);
    g.marks.forEach((row, ri) => row.forEach((m, ci) => {
      const expected = mmToCanonical(frame, m.center[0], m.center[1]);
      const sizePx = (m.isFiducial ? page.fiducials.sizeMm : g.markSizeMm) * frame.pxPerMm;
      const half = Math.round(R + sizePx / 2);
      const x0 = Math.max(0, Math.round(expected.x) - half), y0 = Math.max(0, Math.round(expected.y) - half);
      const x1 = Math.min(bin.cols, Math.round(expected.x) + half), y1 = Math.min(bin.rows, Math.round(expected.y) + half);
      let detected = expected;
      let found = false;
      if (x1 - x0 > 2 && y1 - y0 > 2) {
        const roi = bin.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
        const roiCopy = roi.clone(); // findContours modifies input in older builds
        roi.delete();
        try {
          const expArea = sizePx * sizePx;
          const blobs = findSquareBlobs(cv, roiCopy)
            .filter((b) => b.area > 0.35 * expArea && b.area < 2.2 * expArea)
            .map((b) => ({ ...b, center: { x: b.center.x + x0, y: b.center.y + y0 } }))
            .sort((a, b) => Math.hypot(a.center.x - expected.x, a.center.y - expected.y) - Math.hypot(b.center.x - expected.x, b.center.y - expected.y));
          if (blobs.length) { detected = blobs[0].center; found = true; }
        } finally {
          roiCopy.delete();
        }
      }
      out.push({
        id: m.id, row: ri, col: ci, expected, detected, found,
        offsetMm: Math.hypot(detected.x - expected.x, detected.y - expected.y) / frame.pxPerMm,
      });
    }));
  } finally {
    bin.delete();
  }
  fillMissingMarks(out);
  return out;
}

/** Missing marks inherit the offset interpolated from the nearest found marks in the same column. */
export function fillMissingMarks(marks: ReferenceMarkReadout[]): void {
  const byCol = new Map<number, ReferenceMarkReadout[]>();
  for (const m of marks) (byCol.get(m.col) ?? byCol.set(m.col, []).get(m.col)!).push(m);
  for (const col of byCol.values()) {
    col.sort((a, b) => a.row - b.row);
    for (const m of col) {
      if (m.found) continue;
      const above = [...col].reverse().find((o) => o.found && o.row < m.row);
      const below = col.find((o) => o.found && o.row > m.row);
      const off = (o?: ReferenceMarkReadout) => (o ? { x: o.detected.x - o.expected.x, y: o.detected.y - o.expected.y } : null);
      const a = off(above), b = off(below);
      let d = { x: 0, y: 0 };
      if (a && b) {
        const t = (m.row - above!.row) / (below!.row - above!.row);
        d = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      } else d = a ?? b ?? d;
      m.detected = { x: m.expected.x + d.x, y: m.expected.y + d.y };
    }
  }
}

export function buildCellTransforms(page: OMRPage, marks: ReferenceMarkReadout[], frame: CanonicalFrame, useDetected = true): CellTransform[] {
  const g = page.referenceGrid;
  const at = (r: number, c: number) => marks.find((m) => m.row === r && m.col === c)!;
  const cells: CellTransform[] = [];
  for (let r = 0; r < g.rowYs.length - 1; r++) {
    for (let c = 0; c < g.columnXs.length - 1; c++) {
      const idx: [number, number][] = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]];
      const src = idx.map(([ri, ci]) => ({ x: g.marks[ri][ci].center[0], y: g.marks[ri][ci].center[1] })) as [Vec2, Vec2, Vec2, Vec2];
      const dst = idx.map(([ri, ci]) => (useDetected ? at(ri, ci).detected : at(ri, ci).expected)) as [Vec2, Vec2, Vec2, Vec2];
      cells.push({ row: r, col: c, matrix: homographyFrom4(src, dst), srcQuad: src, dstQuad: dst });
    }
  }
  return cells;
}

export function assertGridMatch(marks: ReferenceMarkReadout[], minRatio: number): number {
  const ratio = marks.filter((m) => m.found).length / marks.length;
  if (ratio < minRatio)
    throw new VisionError("GRID_MISMATCH", `only ${Math.round(ratio * 100)}% of reference marks found (need ${Math.round(minRatio * 100)}%)`, { ratio });
  return ratio;
}

/** Ideal (no-curl) grid for diagnostics: identical to the global warp. */
export function idealMarks(page: OMRPage, frame: CanonicalFrame): ReferenceMarkReadout[] {
  return page.referenceGrid.marks.flatMap((row, ri) => row.map((m, ci) => {
    const p = mmToCanonical(frame, m.center[0], m.center[1]);
    return { id: m.id, row: ri, col: ci, expected: p, detected: p, found: true, offsetMm: 0 };
  }));
}
