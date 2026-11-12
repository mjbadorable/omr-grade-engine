/**
 * Field-calibration support: tunable sensitivity, diagnostic overlay data, and the live camera
 * guardrails. The pencil scenario runs the real OpenCV pipeline on a synthetic faint-graphite sheet.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/omr/layout-engine";
import { PRESETS } from "@/lib/omr/presets";
import type { CV } from "@/lib/vision/cv";
import { buildDiagnosticExport, CONFIDENT_FILL, overlayGeometry, ringClass, summarize } from "@/lib/vision/diagnostics";
import { analyzeFrame, guidance, MESSAGES, QUALITY, StabilityTracker } from "@/lib/vision/frame-quality";
import { classifyGroup, THRESHOLDS } from "@/lib/vision/read-bubbles";
import { scanSheet } from "@/lib/vision/scan-sheet";
import { DEFAULT_TUNING, isDefaultTuning, normalizeTuning, readStoredTuning, thresholdsFor, TUNING_PRESETS, writeStoredTuning } from "@/lib/vision/tuning";
import type { BubbleState } from "@/lib/vision/types";
import { loadCv } from "./helpers/cv-node";
import { frontalQuad, type Markings, photograph, renderPage } from "./helpers/synthetic";

const bubble = (state: BubbleState, confidence: number) => ({ state, confidence });

describe("ring classes (diagnostic overlay colours)", () => {
  it("green only for confident fills; yellow for partial / erasure / shaky fills; red for empty", () => {
    expect(CONFIDENT_FILL).toBe(0.75);
    expect(ringClass(bubble("FILLED", 0.9))).toBe("confident");
    expect(ringClass(bubble("FILLED", 0.75))).toBe("warning");     // must be strictly above 0.75
    expect(ringClass(bubble("FILLED", 0.6))).toBe("warning");
    expect(ringClass(bubble("PARTIAL", 0.99))).toBe("warning");
    expect(ringClass(bubble("ERASURE", 0.99))).toBe("warning");
    expect(ringClass(bubble("EMPTY", 0.99))).toBe("empty");
  });
});

describe("sensitivity tuning", () => {
  it("defaults equal the tuned baseline", () => {
    expect(DEFAULT_TUNING).toEqual({ inkLevel: THRESHOLDS.INK_LEVEL, fillCoverage: THRESHOLDS.FILL_COVERAGE });
    expect(thresholdsFor(undefined)).toEqual({ ...THRESHOLDS });
    expect(isDefaultTuning(normalizeTuning({}))).toBe(true);
    expect(TUNING_PRESETS[0].tuning).toEqual(DEFAULT_TUNING);
  });
  it("clamps out-of-range and garbage values", () => {
    expect(normalizeTuning({ inkLevel: 5, fillCoverage: 2 })).toEqual({ inkLevel: 40, fillCoverage: 0.95 });
    expect(normalizeTuning({ inkLevel: 999, fillCoverage: 0.1 })).toEqual({ inkLevel: 200, fillCoverage: 0.4 });
    expect(normalizeTuning({ inkLevel: NaN as number })).toEqual(DEFAULT_TUNING);
    expect(thresholdsFor({ fillCoverage: 0.4 }).PARTIAL_COVERAGE).toBeLessThan(0.4);
  });
  it("a lower fill-coverage threshold turns a 0.6-coverage bubble into FILLED", () => {
    const S = (density: number, coverage: number) => ({ density, coverage, n: 100 });
    const group = [S(0.5, 0.6), S(0.07, 0)];
    expect(classifyGroup(group, 0.07)[0].state).toBe("PARTIAL");
    expect(classifyGroup(group, 0.07, thresholdsFor({ fillCoverage: 0.55 }))[0].state).toBe("FILLED");
  });
  it("persists only non-default tuning and survives corrupt storage", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    expect(readStoredTuning(st)).toEqual(DEFAULT_TUNING);
    writeStoredTuning({ inkLevel: 85, fillCoverage: 0.7 }, st);
    expect(readStoredTuning(st)).toEqual({ inkLevel: 85, fillCoverage: 0.7 });
    writeStoredTuning(DEFAULT_TUNING, st);
    expect(mem.size).toBe(0);
    mem.set("omr:scanTuning", "{oops");
    expect(readStoredTuning(st)).toEqual(DEFAULT_TUNING);
  });
});

describe("faint pencil through the real pipeline", () => {
  let cv: CV;
  beforeAll(async () => { cv = await loadCv(); });
  const T = computeLayout({ templateId: "tpl-cal", ...PRESETS.find((p) => p.id === "mcq-100")!.settings, examSets: 0, rollDigits: 0, nameField: false, sections: [{ id: "s1", name: "", type: "mcq", questionCount: 20, optionCount: 4, optionStyle: "letters" }] }).template;
  const marks: Markings = {};
  for (let q = 1; q <= 20; q++) marks[`p0:q${q}:${"ABCD"[q % 4]}`] = "pencil";
  const shoot = () => {
    const page = renderPage(cv, T, 0, 6, marks);
    try { return photograph(cv, page, 6, { width: 1200, height: 1600, quad: frontalQuad(T) }).frame; } finally { page.delete(); }
  };

  it("is missed at the baseline, read correctly with the pencil preset, and the diagnostics explain it", () => {
    const frame = shoot();
    const base = scanSheet(cv, frame, T);
    const baseFilled = base.fields.answers.filter((a) => a.marked.length).length;
    expect(baseFilled).toBeLessThan(20);

    const pencil = scanSheet(cv, frame, T, { tuning: TUNING_PRESETS.find((p) => p.id === "pencil")!.tuning });
    for (const a of pencil.fields.answers) expect(a.labels, `Q${a.questionNumber}`).toEqual(["ABCD"[a.questionNumber % 4]]);
    expect(pencil.fields.conflicts).toEqual([]);

    const s = summarize(pencil);
    expect(s.confident + s.warning).toBe(20);
    expect(s.empty).toBe(s.bubbles - 20);
    expect(s.markDetectRatio).toBe(1);
    expect(s.contrast).toBeGreaterThan(0);
    const bs = summarize(base);
    expect(bs.confident).toBeLessThan(20);                         // at the baseline faint graphite is never a confident fill …
    expect(base.fields.answers.some((a) => a.uncertain || a.marked.length === 0)).toBe(true);   // … it shows up as unread / uncertain

    const geo = overlayGeometry(T, pencil);
    expect(geo.corners.map((c) => c.id)).toEqual(["tl", "tr", "br", "bl"]);
    expect(geo.corners[0].center.x).toBeGreaterThan(0);
    expect(geo.bands.length).toBeGreaterThan(1);
    expect(geo.bands.every((b) => b.marks.every((m, i, a) => i === 0 || a[i - 1].detected.x <= m.detected.x))).toBe(true);

    const exp = buildDiagnosticExport(T, pencil, { inkLevel: 85, fillCoverage: 0.7 }, { now: new Date("2026-01-01T00:00:00Z"), userAgent: "test" });
    expect(exp).toMatchObject({ schema: "omr-diagnostic/v1", exportedAt: "2026-01-01T00:00:00.000Z", tuning: { inkLevel: 85 }, template: { layoutHash: T.layoutHash } });
    expect(exp.bubbles).toHaveLength(pencil.bubbles.length);
  }, 60_000);
});

describe("summary advice", () => {
  const base = { bubbles: 100, confident: 20, warning: 0, empty: 80, warningIds: [], meanFilledDensity: 0.7, meanEmptyDensity: 0.05, contrast: 0.65, lowestFilledConfidence: 0.9, markDetectRatio: 1, maxCurlMm: 0, missingMarks: 0, aspectError: 0.01, totalMs: 100, advice: [] };
  it("stays quiet for a healthy sheet and speaks up for each problem", async () => {
    const { advise } = await import("@/lib/vision/diagnostics");
    expect(advise(base)).toEqual([]);
    expect(advise({ ...base, warning: 5 })[0]).toMatch(/Faint #2 pencil/);
    expect(advise({ ...base, contrast: 0.1 })[0]).toMatch(/Low contrast/);
    expect(advise({ ...base, markDetectRatio: 0.7, missingMarks: 9 })[0]).toMatch(/70%/);
    expect(advise({ ...base, maxCurlMm: 5 })[0]).toMatch(/curl/);
    expect(advise({ ...base, confident: 0, warning: 0, empty: 100 })[0]).toMatch(/No marks/);
  });
});

// ------------------------------------------------------------------ camera guardrails
function frame(w: number, h: number, fill: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fill(x, y); const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  return d;
}
const W = 160, H = 90;

describe("camera quality: darkness and glare", () => {
  it("flags a dim frame as too dark", () => {
    const q = analyzeFrame(frame(W, H, () => [40, 40, 40]), W, H);
    expect(q.dark).toBe(true);
    expect(guidance(q, { aligned: true, stable: true, streak: 9, jitter: 0 }).messages).toEqual([MESSAGES.dark]);
    expect(MESSAGES.dark).toBe("Too Dark — Move to brighter light or turn on torch");
  });
  it("a normally lit white sheet is fine (no false glare, even though paper is bright)", () => {
    const q = analyzeFrame(frame(W, H, () => [215, 215, 210]), W, H);
    expect(q).toMatchObject({ dark: false, glare: false });
    const clipped = analyzeFrame(frame(W, H, (x) => (x % 40 < 3 ? [20, 20, 20] : [255, 255, 255])), W, H);   // blown-out paper but not overexposed globally, median 255
    expect(clipped.glare).toBe(false);
  });
  it("a clipped specular highlight on mid-bright paper is glare", () => {
    const q = analyzeFrame(frame(W, H, (x, y) => (x > 90 && x < 130 && y > 20 && y < 60 ? [255, 255, 255] : [170, 170, 165])), W, H);
    expect(q.saturatedFraction).toBeGreaterThan(QUALITY.GLARE_SATURATED);
    expect(q.glare).toBe(true);
    expect(guidance(q, { aligned: true, stable: true, streak: 9, jitter: 0 }).messages).toEqual([MESSAGES.glare]);
    expect(MESSAGES.glare).toBe("Glare Detected — Tilt phone slightly");
  });
  it("a washed-out registration square counts as glare even without a big highlight", () => {
    const f = frame(W, H, () => [180, 180, 180]);                     // square should be black but reads light grey
    expect(analyzeFrame(f, W, H, [{ x: 20, y: 15 }]).glare).toBe(true);
    const dark = frame(W, H, (x, y) => (Math.abs(x - 20) < 6 && Math.abs(y - 15) < 6 ? [15, 15, 15] : [180, 180, 180]));
    expect(analyzeFrame(dark, W, H, [{ x: 20, y: 15 }]).glare).toBe(false);
  });
  it("a fully clipped white frame is reported as overexposed but only washed-out marks make it glare; dark wins the message order", () => {
    const white = analyzeFrame(frame(W, H, () => [255, 255, 255]), W, H);
    expect(white).toMatchObject({ overexposed: true, glare: false });
    expect(analyzeFrame(frame(W, H, () => [255, 255, 255]), W, H, [{ x: 20, y: 15 }]).glare).toBe(true);   // the registration square is gone
    const both = { meanLuma: 30, medianLuma: 30, saturatedFraction: 0.2, dark: true, glare: true, overexposed: false, washedOutCorners: 0 };
    expect(guidance(both, { aligned: true, stable: true, streak: 9, jitter: 0 }).issues).toEqual(["dark"]);
  });
});

describe("camera stability: Hold Steady", () => {
  const quad = (dx = 0, dy = 0) => ({ tl: { x: 100 + dx, y: 100 + dy }, tr: { x: 900 + dx, y: 100 + dy }, br: { x: 900 + dx, y: 1100 + dy }, bl: { x: 100 + dx, y: 1100 + dy } });
  it("becomes stable only after consecutive near-identical frames", () => {
    const t = new StabilityTracker();
    const states = Array.from({ length: 6 }, (_, i) => t.push(quad(i * 0.5, 0)));
    expect(states.map((s) => s.stable)).toEqual([false, false, false, false, true, true]);
    expect(states[5]).toMatchObject({ aligned: true, streak: 5 });
  });
  it("a jump or a lost corner resets the streak", () => {
    const t = new StabilityTracker();
    for (let i = 0; i < 6; i++) t.push(quad());
    expect(t.push(quad(60, 0)).stable).toBe(false);                    // moved 60 px of a ~1280 px diagonal
    for (let i = 0; i < 3; i++) t.push(quad(60, 0));
    expect(t.push(null)).toEqual({ aligned: false, stable: false, streak: 0, jitter: null });
    expect(t.push(quad(60, 0)).stable).toBe(false);
  });
  it("guidance asks to hold steady until aligned and stable, then is clear", () => {
    const fine = analyzeFrame(frame(W, H, () => [210, 210, 210]), W, H);
    expect(guidance(fine, null).messages).toEqual([MESSAGES.steady]);
    expect(guidance(fine, { aligned: true, stable: false, streak: 1, jitter: 0.05 }).messages).toEqual(["Hold Steady — Align all 4 corners"]);
    expect(guidance(fine, { aligned: true, stable: true, streak: 5, jitter: 0 })).toEqual({ ok: true, issues: [], messages: [] });
  });
});
