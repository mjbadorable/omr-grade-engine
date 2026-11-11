import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/omr/layout-engine";
import { PRESETS } from "@/lib/omr/presets";
import {
  applyHomography, canonicalFrame, homographyFrom4, invertMat3, isConvexQuad, mmToCanonical, validateCorners,
} from "@/lib/vision/geometry";
import { buildCellTransforms, fillMissingMarks, idealMarks } from "@/lib/vision/curl-correction";
import { type Mat3, VisionError } from "@/lib/vision/types";

const H: Mat3 = [1.2, 0.15, 30, -0.08, 0.95, 12, 0.0004, -0.0002, 1];
const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 140 }, { x: 0, y: 140 }];

describe("homographyFrom4", () => {
  it("recovers a known projective map exactly", () => {
    const dst = sq.map((p) => applyHomography(H, p));
    const est = homographyFrom4(sq, dst);
    est.forEach((v, i) => expect(v).toBeCloseTo(H[i], 9));
    const probe = applyHomography(est, { x: 37, y: 91 });
    const truth = applyHomography(H, { x: 37, y: 91 });
    expect(probe.x).toBeCloseTo(truth.x, 8);
    expect(probe.y).toBeCloseTo(truth.y, 8);
  });

  it("inverts", () => {
    const back = applyHomography(invertMat3(H), applyHomography(H, { x: 12.5, y: -7 }));
    expect(back.x).toBeCloseTo(12.5, 9);
    expect(back.y).toBeCloseTo(-7, 9);
  });

  it("rejects collinear points", () => {
    const line = [0, 1, 2, 3].map((i) => ({ x: i, y: 2 * i }));
    expect(() => homographyFrom4(line, sq)).toThrow(VisionError);
  });
});

describe("validateCorners", () => {
  const size = { width: 1000, height: 1400 };
  const pts = [{ x: 100, y: 120 }, { x: 880, y: 100 }, { x: 900, y: 1290 }, { x: 90, y: 1300 }];
  const aspect = (880 - 100) / (1300 - 120);

  it("orders shuffled points TL/TR/BR/BL", () => {
    const c = validateCorners([pts[2], pts[0], pts[3], pts[1]], aspect, size);
    expect([c.tl, c.tr, c.br, c.bl]).toEqual(pts);
    expect(c.aspectError).toBeCloseTo(1, 1);
  });

  it("rejects wrong aspect, tiny quads and non-convex sets", () => {
    expect(() => validateCorners(pts, aspect * 1.6, size)).toThrow(/aspect/);
    const tiny = pts.map((p) => ({ x: 400 + p.x / 20, y: 400 + p.y / 20 }));
    expect(() => validateCorners(tiny, aspect, size)).toThrow(/too small/);
    expect(isConvexQuad(pts[0], pts[2], pts[1], pts[3])).toBe(false);
    expect(() => validateCorners(pts.slice(0, 3), aspect, size)).toThrow(VisionError);
  });
});

describe("cell transforms", () => {
  const t = computeLayout({ templateId: "tpl-geo", ...PRESETS[0].settings }).template;
  const page = t.pages[0];
  const frame = canonicalFrame(t);

  it("one transform per 5-row band, identical to the global mapping when nothing is curled", () => {
    const cells = buildCellTransforms(page, idealMarks(page, frame), frame);
    expect(cells).toHaveLength(page.referenceGrid.rowYs.length - 1);
    for (const c of cells) {
      const mid = { x: (c.srcQuad[0].x + c.srcQuad[2].x) / 2, y: (c.srcQuad[0].y + c.srcQuad[2].y) / 2 };
      const got = applyHomography(c.matrix, mid);
      const want = mmToCanonical(frame, mid.x, mid.y);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it("follows a locally displaced band and leaves the others untouched", () => {
    const marks = idealMarks(page, frame);
    // push row 4 of marks down by 2 mm (a curl at that height)
    for (const m of marks) if (m.row === 4) m.detected = { x: m.detected.x, y: m.detected.y + 2 * frame.pxPerMm };
    const cells = buildCellTransforms(page, marks, frame);
    const yAt = (row: number, frac: number) => page.referenceGrid.rowYs[row] + frac * (page.referenceGrid.rowYs[row + 1] - page.referenceGrid.rowYs[row]);
    const shift = (row: number, frac: number) =>
      (applyHomography(cells[row].matrix, { x: 50, y: yAt(row, frac) }).y - mmToCanonical(frame, 50, yAt(row, frac)).y) / frame.pxPerMm;
    expect(shift(3, 1)).toBeCloseTo(2, 6);   // bottom of band 3 = row-4 marks
    expect(shift(4, 0)).toBeCloseTo(2, 6);   // top of band 4
    expect(shift(1, 0.5)).toBeCloseTo(0, 6); // unaffected band
  });

  it("interpolates missing marks from their column neighbours", () => {
    const marks = idealMarks(page, frame);
    const off = 3;
    for (const m of marks) if (m.col === 0) m.detected = { x: m.detected.x + off * m.row, y: m.detected.y };
    const gap = marks.find((m) => m.col === 0 && m.row === 3)!;
    gap.found = false;
    gap.detected = gap.expected;
    fillMissingMarks(marks);
    expect(gap.detected.x - gap.expected.x).toBeCloseTo(off * 3, 6);
  });
});

describe("selectCorners", () => {
  it("always picks the outermost valid quad, even when an inner blob fits the aspect better", async () => {
    const { selectCorners } = await import("@/lib/vision/detect-corners");
    const c = (x: number, y: number, area = 400) => ({ center: { x, y }, area, aspect: 1, fill: 0.95, holeRatio: 0 });
    const real = [c(120, 125), c(1080, 125), c(1080, 1475), c(120, 1475)];
    // a filled bubble inside the sheet, near the top-left corner, with a fiducial-like area
    const blob = c(370, 200, 380);
    const picked = selectCorners([blob, ...real], 960 / 1340, { width: 1200, height: 1600 });
    expect([picked.tl, picked.tr, picked.br, picked.bl]).toEqual(real.map((r) => r.center));
  });
});
