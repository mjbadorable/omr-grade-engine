/**
 * End-to-end: synthetic photographs (known distortion) → scanSheet → decoded fields.
 * Real OpenCV.js (WASM) runs in Node; every scenario is deterministic.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/omr/layout-engine";
import { PRESETS } from "@/lib/omr/presets";
import type { LayoutSettings, OMRTemplate } from "@/lib/omr/schema";
import type { CV } from "@/lib/vision/cv";
import { applyHomography } from "@/lib/vision/geometry";
import { bubbleRefs } from "@/lib/vision/read-bubbles";
import { scanSheet } from "@/lib/vision/scan-sheet";
import { type ScanTelemetry, VisionError } from "@/lib/vision/types";
import { loadCv } from "./helpers/cv-node";
import { frontalQuad, type Markings, photograph, type PhotoOptions, renderPage } from "./helpers/synthetic";

const PAGE_PX_PER_MM = 6;
let cv: CV;
beforeAll(async () => { cv = await loadCv(); });

const template = (id: string, extra: Partial<LayoutSettings> = {}): OMRTemplate =>
  computeLayout({ templateId: id, ...PRESETS.find((p) => p.id === "jee")!.settings, ...extra }).template;

const T = template("tpl-e2e");

/** Deterministic answer key for Q1–30 plus roll / set / numeric / matrix marks. */
function studentSheet(roll = "2024123456", set = "C") {
  const answers: Record<number, string> = {};
  const marks: Markings = {};
  for (let q = 1; q <= 30; q++) {
    const opt = "ABCD"[(q * 7 + 3) % 4];
    answers[q] = opt;
    marks[`p0:q${q}:${opt}`] = "fill";
  }
  [...roll].forEach((d, i) => { marks[`p0:roll:d${i}:${d}`] = "fill"; });
  marks[`p0:set:${set}`] = "fill";
  // Q31 = -12.5 ; Q32 = 305 ; Q33 matrix A→P,Q  C→T
  Object.assign(marks, {
    "p0:q31:sign": "fill", "p0:q31:d0:1": "fill", "p0:q31:d1:2": "fill", "p0:q31:dot:d2": "fill", "p0:q31:d3:5": "fill",
    "p0:q32:d0:3": "fill", "p0:q32:d1:0": "fill", "p0:q32:d2:5": "fill",
    "p0:q33:AP": "fill", "p0:q33:AQ": "fill", "p0:q33:CT": "fill",
  });
  return { answers, marks, roll, set };
}

function shoot(t: OMRTemplate, marks: Markings, photo: Partial<PhotoOptions> = {}, pageIndex = 0) {
  const page = renderPage(cv, t, pageIndex, PAGE_PX_PER_MM, marks);
  try {
    return photograph(cv, page, PAGE_PX_PER_MM, { width: 1200, height: 1600, quad: frontalQuad(t), ...photo });
  } finally {
    page.delete();
  }
}

function expectStudent(r: ReturnType<typeof scanSheet>, s: ReturnType<typeof studentSheet>) {
  expect(r.fields.rollNumber).toBe(s.roll);
  expect(r.fields.examSet).toBe(s.set);
  for (const a of r.fields.answers) expect(a.labels, `Q${a.questionNumber}`).toEqual([s.answers[a.questionNumber]]);
  expect(r.fields.numeric.map((n) => n.value)).toEqual(["-12.5", "305"]);
  expect(r.fields.matrix[0].rows).toEqual({ A: ["P", "Q"], B: [], C: ["T"], D: [] });
  expect(r.fields.conflicts).toEqual([]);
}

/** Ground-truth canonical px of every bubble (page mm → page px → photo → normalized → canonical). */
function bubbleErrorsMm(t: OMRTemplate, r: ReturnType<typeof scanSheet>, forward: (p: { x: number; y: number }) => { x: number; y: number }) {
  const [ox, oy] = t.paper.originMm;
  const refs = new Map(bubbleRefs(t.pages[r.pageIndex]).map((b) => [b.id, b]));
  return r.bubbles.map((b) => {
    const mm = refs.get(b.bubbleId)!.centerMm;
    const photo = forward({ x: (mm[0] + ox) * PAGE_PX_PER_MM, y: (mm[1] + oy) * PAGE_PX_PER_MM });
    const truth = applyHomography(r.globalWarp, { x: photo.x * r.frameScale, y: photo.y * r.frameScale });
    return Math.hypot(truth.x - b.center.x, truth.y - b.center.y) / r.canonical.pxPerMm;
  });
}

const SKEW: PhotoOptions["quad"] = [{ x: 210, y: 150 }, { x: 1040, y: 95 }, { x: 1135, y: 1520 }, { x: 85, y: 1450 }];

describe("scanSheet: geometry", () => {
  it("reads a clean frontal photo exactly and locates the fiducials within 1.5 px", () => {
    const s = studentSheet();
    const photo = shoot(T, s.marks);
    const r = scanSheet(cv, photo.frame, T);
    expectStudent(r, s);
    expect(r.qr).toMatchObject({ matchesTemplate: true, pageIndex: 0, rotated180: false });
    expect(r.markDetectRatio).toBe(1);
    const [ox, oy] = T.paper.originMm;
    const f = T.pages[0].fiducials;
    for (const [k, m] of [["tl", f.tl], ["tr", f.tr], ["br", f.br], ["bl", f.bl]] as const) {
      const truth = photo.forward({ x: (m.center[0] + ox) * PAGE_PX_PER_MM, y: (m.center[1] + oy) * PAGE_PX_PER_MM });
      expect(Math.hypot(truth.x - r.corners[k].x, truth.y - r.corners[k].y), k).toBeLessThan(1.5);
    }
    expect(Math.max(...bubbleErrorsMm(T, r, photo.forward))).toBeLessThan(0.25);
  });

  it("de-skews a strong perspective / rotation", () => {
    const s = studentSheet("9876501234", "A");
    const photo = shoot(T, s.marks, { quad: SKEW });
    const r = scanSheet(cv, photo.frame, T);
    expectStudent(r, s);
    expect(Math.max(...bubbleErrorsMm(T, r, photo.forward))).toBeLessThan(0.3);
  });

  it("neutralises paper curl with per-band homographies (and beats the global warp)", () => {
    const s = studentSheet();
    const photo = shoot(T, s.marks, { curlMm: { sag: 4, bulge: 0.5 } });
    const piecewise = scanSheet(cv, photo.frame, T);
    const globalOnly = scanSheet(cv, photo.frame, T, { curlCorrection: false });
    const ep = bubbleErrorsMm(T, piecewise, photo.forward);
    const eg = bubbleErrorsMm(T, globalOnly, photo.forward);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(Math.max(...ep)).toBeLessThan(0.6);
    expect(mean(ep)).toBeLessThan(mean(eg) / 4);
    expect(Math.max(...eg)).toBeGreaterThan(2);           // the global warp alone is off by > 2 mm
    expect(Math.max(...piecewise.referenceMarks.map((m) => m.offsetMm))).toBeGreaterThan(2);
    expectStudent(piecewise, s);
  });

  it("reads a sheet photographed upside down (QR-guided 180° turn)", () => {
    const s = studentSheet();
    const q = frontalQuad(T);
    const photo = shoot(T, s.marks, { quad: [q[2], q[3], q[0], q[1]] });
    const r = scanSheet(cv, photo.frame, T);
    expect(r.qr.rotated180).toBe(true);
    expectStudent(r, s);
    expect(Math.max(...bubbleErrorsMm(T, r, photo.forward))).toBeLessThan(0.3);
  });
});

describe("scanSheet: lighting", () => {
  it("survives a dark gradient, a hard shadow, sensor noise and blur on a skewed photo", () => {
    const s = studentSheet("5550001119", "D");
    const photo = shoot(T, s.marks, {
      quad: SKEW, gradientLow: 0.38, shadow: { x: 700, y: 800, sigma: 260, depth: 0.55 }, noiseSigma: 7, blur: true, seed: 42,
    });
    const r = scanSheet(cv, photo.frame, T);
    expectStudent(r, s);
  });
});

describe("scanSheet: high-resolution camera frames", () => {
  it("reads the QR from the full-resolution frame even when the working copy is downscaled", () => {
    const s = studentSheet();
    const photo = shoot(T, s.marks, {
      width: 1500, height: 2000,
      quad: [{ x: 260, y: 190 }, { x: 1300, y: 120 }, { x: 1420, y: 1900 }, { x: 105, y: 1810 }],
      gradientLow: 0.45, shadow: { x: 900, y: 1000, sigma: 320, depth: 0.5 }, noiseSigma: 6, blur: true, curlMm: { sag: 3, bulge: 0.4 },
    });
    const r = scanSheet(cv, photo.frame, T);
    expect(r.frameScale).toBeLessThan(1);
    expect(r.qr).toMatchObject({ matchesTemplate: true, pageIndex: 0 });
    expectStudent(r, s);
  });
});

describe("scanSheet: mark states", () => {
  it("classifies light pencil, partial fills and erasures", () => {
    const s = studentSheet();
    // clear the original answers for Q5/Q6 first, then apply the special marks
    delete s.marks[`p0:q5:${s.answers[5]}`];
    delete s.marks[`p0:q6:${s.answers[6]}`];
    Object.assign(s.marks, {
      "p0:q1:A": "erasure", // erased first choice beside the real answer
      "p0:q5:A": "light",   // light pencil still counts
      "p0:q6:B": "partial",
    });
    s.answers[5] = "A";
    const r = scanSheet(cv, shoot(T, s.marks, { quad: SKEW, gradientLow: 0.6 }).frame, T);
    const state = (id: string) => r.bubbles.find((b) => b.bubbleId === id)!.state;
    expect(s.answers[1]).not.toBe("A");
    expect(state("p0:q1:A")).toBe("ERASURE");
    expect(state("p0:q5:A")).toBe("FILLED");
    expect(state("p0:q6:B")).toBe("PARTIAL");
    const a = Object.fromEntries(r.fields.answers.map((x) => [x.questionNumber, x]));
    expect(a[1].labels).toEqual([s.answers[1]]);
    expect(a[5].labels).toEqual(["A"]);
    expect(a[6]).toMatchObject({ marked: [], uncertain: true });
    expect(r.fields.conflicts.map((c) => `${c.code}@${c.index}`)).toEqual(["ANSWER_UNCERTAIN@6"]);
    for (const b of r.bubbles) {
      expect(b.density).toBeGreaterThanOrEqual(0);
      expect(b.density).toBeLessThanOrEqual(1);
    }
  });

  it("emits explicit conflict payloads for roll/set problems", () => {
    const s = studentSheet("2024123456", "B");
    s.marks["p0:roll:d2:9"] = "fill";      // column 2 → 2 and 9
    delete s.marks["p0:roll:d4:1"];        // column 4 blank
    s.marks["p0:set:D"] = "fill";          // two sets
    const r = scanSheet(cv, shoot(T, s.marks).frame, T);
    expect(r.fields.rollNumber).toBeNull();
    const codes = r.fields.conflicts.map((c) => `${c.code}@${c.index}`).sort();
    expect(codes).toEqual(["ROLL_DIGIT_BLANK@4", "ROLL_DIGIT_MULTIPLE@2", "SET_MULTIPLE@0"]);
    expect(r.fields.conflicts.find((c) => c.code === "ROLL_DIGIT_MULTIPLE")!.bubbleIds.sort()).toEqual(["p0:roll:d2:2", "p0:roll:d2:9"]);
  });
});

describe("scanSheet: identity, errors and telemetry", () => {
  it("auto-selects page 2 of a multi-page template from its QR code", () => {
    const multi = computeLayout({
      templateId: "tpl-multi", ...PRESETS[0].settings, columns: 1,
      sections: [{ id: "s", name: "", type: "mcq", questionCount: 120, optionCount: 4, optionStyle: "letters" }],
    }).template;
    expect(multi.pages.length).toBeGreaterThan(1);
    const firstOnP2 = multi.pages[1].regions.find((r) => r.kind === "mcq");
    if (!firstOnP2 || firstOnP2.kind !== "mcq") throw new Error("no mcq on page 2");
    const q = firstOnP2.questions[0].number;
    const r = scanSheet(cv, shoot(multi, { [`p1:q${q}:C`]: "fill" }, {}, 1).frame, multi);
    expect(r.pageIndex).toBe(1);
    expect(r.fields.answers.find((a) => a.questionNumber === q)!.labels).toEqual(["C"]);
  });

  it("rejects sheets printed from another template, unless allowed", () => {
    const other = template("tpl-other");
    const frame = shoot(other, studentSheet().marks).frame;
    expect(() => scanSheet(cv, frame, T)).toThrowError(expect.objectContaining({ code: "TEMPLATE_MISMATCH" }));
    expect(scanSheet(cv, frame, T, { requireTemplateMatch: false }).fields.rollNumber).toBe("2024123456");
  });

  it("reports CORNERS_NOT_FOUND on a frame without a sheet and INVALID_INPUT on bad buffers", () => {
    const blank = { width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4).fill(180) };
    expect(() => scanSheet(cv, blank, T)).toThrowError(expect.objectContaining({ code: "CORNERS_NOT_FOUND" }));
    expect(() => scanSheet(cv, { width: 10, height: 10, data: new Uint8ClampedArray(3) }, T)).toThrow(VisionError);
  });

  it("emits ordered telemetry and is deterministic", () => {
    const frame = shoot(T, studentSheet().marks, { quad: SKEW }).frame;
    const events: ScanTelemetry[] = [];
    const a = scanSheet(cv, frame, T, { onTelemetry: (e) => events.push(e) });
    const b = scanSheet(cv, frame, T);
    expect(events.map((e) => e.status)).toEqual(["processing", "searching", "aligned", "processing", "processing", "success"]);
    expect(events.at(-1)!.cornersDetected).toBe(true);
    const strip = (r: typeof a) => JSON.stringify({ ...r, timingsMs: null });
    expect(strip(a)).toBe(strip(b));
  });
});
