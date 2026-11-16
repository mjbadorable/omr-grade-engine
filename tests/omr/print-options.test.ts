import { describe, expect, it } from "vitest";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import { INK, pagePrimitives, type Prim } from "@/lib/omr/primitives";
import { applyDarkness, nUpLayout, sheetCrop } from "@/lib/omr/print-options";
import { drawPrimsToContext } from "@/lib/omr/png-export";

const { template } = buildSampleExam();
const prims = pagePrimitives(template, template.pages[0]);

describe("applyDarkness", () => {
  it("standard leaves the draw list untouched", () => {
    expect(applyDarkness(prims, "standard")).toEqual(prims);
  });
  it("high-contrast darkens outlines for photocopying, never moves anything", () => {
    const hi = applyDarkness(prims, "high");
    expect(hi).toHaveLength(prims.length);
    prims.forEach((p, i) => {
      const h = hi[i];
      expect(h.t).toBe(p.t);
      if (p.t === "circle" && h.t === "circle") {
        expect([h.cx, h.cy, h.r]).toEqual([p.cx, p.cy, p.r]);
        expect(h.stroke).toBe(INK.solid);
        expect(h.strokeW).toBeGreaterThan(p.strokeW);
      }
      if (p.t === "rect" && h.t === "rect") expect([h.x, h.y, h.w, h.h]).toEqual([p.x, p.y, p.w, p.h]);
    });
  });
  it("keeps the light bubble letters light so they are not read as marks", () => {
    const hi = applyDarkness(prims, "high");
    const labels = hi.filter((p): p is Extract<Prim, { t: "text" }> => p.t === "text" && p.fill === INK.bubbleLabel);
    expect(labels.length).toBeGreaterThan(0);
  });
});

describe("sheetCrop", () => {
  it("is the registered sheet area plus a small quiet margin, inside the paper", () => {
    const c = sheetCrop(template);
    const [ox, oy] = template.paper.originMm;
    expect(c.x).toBeLessThanOrEqual(ox);
    expect(c.y).toBeLessThanOrEqual(oy);
    expect(c.x + c.w).toBeGreaterThanOrEqual(ox + template.sheet.widthMm);
    expect(c.y + c.h).toBeGreaterThanOrEqual(oy + template.sheet.heightMm);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(template.paper.widthMm + 1e-9);
    expect(c.y + c.h).toBeLessThanOrEqual(template.paper.heightMm + 1e-9);
  });
});

describe("nUpLayout", () => {
  const crop = sheetCrop(template);
  it("1-up is the paper itself at full scale", () => {
    const l = nUpLayout(template.paper, crop, 1);
    expect(l.cells).toHaveLength(1);
    expect(l.cells[0].scale).toBe(1);
    expect([l.pageWidthMm, l.pageHeightMm]).toEqual([template.paper.widthMm, template.paper.heightMm]);
  });
  it("2-up is landscape with two equal, uniformly-scaled cells that fit the page", () => {
    const l = nUpLayout(template.paper, crop, 2);
    expect(l.pageWidthMm).toBeGreaterThan(l.pageHeightMm);
    expect(l.cells).toHaveLength(2);
    expect(l.cells[0].scale).toBeCloseTo(l.cells[1].scale, 9);
    expect(l.cells[0].scale).toBeLessThan(1);
  });
  it("4-up is a 2x2 portrait grid at a smaller scale again", () => {
    const l2 = nUpLayout(template.paper, crop, 2);
    const l4 = nUpLayout(template.paper, crop, 4);
    expect(l4.pageHeightMm).toBeGreaterThan(l4.pageWidthMm);
    expect(l4.cells).toHaveLength(4);
    expect(l4.cells[0].scale).toBeLessThan(l2.cells[0].scale);
  });
  it("never lets a scaled sheet leave its page, and keeps cells from overlapping", () => {
    for (const n of [2, 4] as const) {
      const l = nUpLayout(template.paper, crop, n);
      for (const c of l.cells) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + crop.w * c.scale).toBeLessThanOrEqual(l.pageWidthMm + 1e-9);
        expect(c.y + crop.h * c.scale).toBeLessThanOrEqual(l.pageHeightMm + 1e-9);
      }
      for (let i = 0; i < l.cells.length; i++) {
        for (let j = i + 1; j < l.cells.length; j++) {
          const a = l.cells[i], b = l.cells[j];
          const overlapX = a.x < b.x + crop.w * b.scale && b.x < a.x + crop.w * a.scale;
          const overlapY = a.y < b.y + crop.h * b.scale && b.y < a.y + crop.h * a.scale;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    }
  });
});

describe("drawPrimsToContext (PNG export)", () => {
  function recorder() {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k: string) => (typeof k === "string" && k !== "then" ? (...a: unknown[]) => { calls.push(`${k}(${a.map((x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x)).join(",")})`); } : undefined),
      set: (_t, k: string, v) => { calls.push(`${k}=${v}`); return true; },
    });
    return { ctx: ctx as never, calls };
  }
  it("maps millimetres to pixels, relative to the crop origin", () => {
    const { ctx, calls } = recorder();
    drawPrimsToContext(ctx, [{ t: "rect", x: 20, y: 30, w: 4, h: 2, fill: "#000000" }], 10, { x: 10, y: 10 });
    expect(calls).toContain("fillRect(100,200,40,20)");
  });
  it("draws circles and text, shrinking text to its box", () => {
    const { ctx, calls } = recorder();
    drawPrimsToContext(ctx, [
      { t: "circle", cx: 15, cy: 15, r: 2, stroke: "#262626", strokeW: 0.3 },
      { t: "text", x: 12, y: 12, text: "A", size: 3, bold: false, anchor: "middle", fill: "#111111", maxW: 5 },
    ], 10, { x: 10, y: 10 });
    expect(calls.some((c) => c.startsWith("arc(50,50,20"))).toBe(true);
    expect(calls.some((c) => c.startsWith("fillText(A,20,20,50"))).toBe(true);
  });
});
