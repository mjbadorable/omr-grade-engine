import { describe, expect, it } from "vitest";
import { classifyGroup, sampleDisk, sheetBaseline, THRESHOLDS } from "@/lib/vision/read-bubbles";

/** 40×40 darkness canvas with a drawing callback. */
function canvas(paint: (x: number, y: number) => number) {
  const w = 40, h = 40;
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = paint(x, y);
  return { d, w, h };
}

describe("sampleDisk", () => {
  it("measures a solid disc, a half disc and blank paper", () => {
    const solid = canvas(() => 230);
    expect(sampleDisk(solid.d, 40, 40, 20, 20, 8)).toMatchObject({ coverage: 1 });
    expect(sampleDisk(solid.d, 40, 40, 20, 20, 8).density).toBeCloseTo(230 / 255, 6);

    const half = canvas((x) => (x < 20 ? 230 : 10));
    const s = sampleDisk(half.d, 40, 40, 20, 20, 8);
    expect(s.coverage).toBeGreaterThan(0.4);
    expect(s.coverage).toBeLessThan(0.55);

    const blank = canvas(() => 12);
    expect(sampleDisk(blank.d, 40, 40, 20, 20, 8)).toMatchObject({ coverage: 0 });
  });

  it("clips at image borders and samples only inside the radius", () => {
    const ring = canvas((x, y) => (Math.hypot(x - 20, y - 20) > 9 ? 255 : 0)); // printed outline outside r
    expect(sampleDisk(ring.d, 40, 40, 20, 20, 7).density).toBe(0);
    expect(sampleDisk(ring.d, 40, 40, 0, 0, 5).n).toBeGreaterThan(0);
  });
});

describe("classifyGroup", () => {
  const S = (density: number, coverage: number) => ({ density, coverage, n: 150 });

  it("separates filled / partial / erasure / empty", () => {
    const res = classifyGroup([S(0.85, 1), S(0.45, 0.5), S(0.2, 0), S(0.07, 0)], 0.07);
    expect(res.map((r) => r.state)).toEqual(["FILLED", "PARTIAL", "ERASURE", "EMPTY"]);
    for (const r of res) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("is invariant to a uniform darkness offset (dim lighting / grey paper)", () => {
    const shift = 0.12;
    const res = classifyGroup([S(0.85 + shift, 1), S(0.07 + shift, 0), S(0.08 + shift, 0), S(0.07 + shift, 0.01)], 0.07 + shift);
    expect(res.map((r) => r.state)).toEqual(["FILLED", "EMPTY", "EMPTY", "EMPTY"]);
  });

  it("caps a group baseline near the sheet baseline so an all-marked group still reads as marked", () => {
    const res = classifyGroup([S(0.3, 0.05), S(0.31, 0.05)], 0.07);
    expect(res.every((r) => r.state === "ERASURE")).toBe(true);
  });

  it("borderline coverage near the fill threshold has low confidence", () => {
    const [r] = classifyGroup([S(0.7, THRESHOLDS.FILL_COVERAGE + 0.01), S(0.07, 0)], 0.07);
    expect(r.state).toBe("FILLED");
    expect(r.confidence).toBeLessThan(0.6);
  });

  it("sheetBaseline = median of the lightest third", () => {
    expect(sheetBaseline([0.9, 0.05, 0.07, 0.06, 0.8, 0.85])).toBeCloseTo(0.06, 6);
  });
});
