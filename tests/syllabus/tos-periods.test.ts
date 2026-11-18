import { describe, expect, it } from "vitest";
import { parseSyllabusPages, parseSyllabusText, type PdfPageItems } from "@/lib/syllabus/parse-syllabus";
import { assignOutcomes, generateTos, modulesForPeriod } from "@/lib/syllabus/tos";
import fixture from "./fixtures/hm5-items.json";
import { IT321_TEXT } from "./fixtures/it321";

const pages = (): PdfPageItems[] => (fixture.pages as { width: number; height: number; items: [string, number, number, number, number][] }[])
  .map((p) => ({ width: p.width, height: p.height, items: p.items.map(([str, x, y, w, size]) => ({ str, x, y, w, size })) }));
const hm5 = parseSyllabusPages(pages()).syllabus;
const clase = parseSyllabusText(IT321_TEXT).syllabus;

describe("modulesForPeriod follows the syllabus's own grouping", () => {
  it("HM5: PRELIM = M1–M2 (M0 orientation excluded), MIDTERM = M3–M4, FINAL = M5–M6", () => {
    expect(modulesForPeriod(hm5, "PRELIM").map((m) => m.number)).toEqual([1, 2]);
    expect(modulesForPeriod(hm5, "MIDTERM").map((m) => m.number)).toEqual([3, 4]);
    expect(modulesForPeriod(hm5, "FINAL").map((m) => m.number)).toEqual([5, 6]);
  });
  it("CLASE is unchanged: 1–3 / 4–6 / 7–9", () => {
    expect(modulesForPeriod(clase, "PRELIM").map((m) => m.number)).toEqual([1, 2, 3]);
    expect(modulesForPeriod(clase, "MIDTERM").map((m) => m.number)).toEqual([4, 5, 6]);
    expect(modulesForPeriod(clase, "FINAL").map((m) => m.number)).toEqual([7, 8, 9]);
  });
  it("can instead follow the syllabus's cumulative exam coverage (Midterm covers M1–M4)", () => {
    expect(modulesForPeriod(hm5, "MIDTERM", { cumulative: true }).map((m) => m.number)).toEqual([1, 2, 3, 4]);
    expect(modulesForPeriod(hm5, "FINAL", { cumulative: true }).map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("cumulative falls back to the period's own modules when the syllabus states no coverage", () => {
    expect(modulesForPeriod(clase, "MIDTERM", { cumulative: true }).map((m) => m.number)).toEqual([4, 5, 6]);
  });
});

describe("generateTos on a COB syllabus", () => {
  it("never gives the orientation module any questions", () => {
    const tos = generateTos(hm5, "PRELIM", 50);
    expect(tos.rows.map((r) => r.moduleNumber)).toEqual([1, 2]);
    expect(tos.rows.reduce((n, r) => n + r.questions, 0)).toBe(50);
  });
  it("weights by lecture hours (the written exam) rather than lab hours", () => {
    // M1 and M2 both have 2 lecture hours but 6 and 7 lab hours: an even split, not 6:7.
    expect(generateTos(hm5, "PRELIM", 50).rows.map((r) => r.questions)).toEqual([25, 25]);
  });
  it("splits across the cumulative coverage when asked", () => {
    const tos = generateTos(hm5, "MIDTERM", 40, { cumulative: true });
    expect(tos.rows.map((r) => r.moduleNumber)).toEqual([1, 2, 3, 4]);
    expect(tos.rows.map((r) => r.questions)).toEqual([10, 10, 10, 10]);
  });
  it("assigns each question to a module's course outcomes", () => {
    const a = assignOutcomes(generateTos(hm5, "PRELIM", 6), hm5);
    expect(a.map((x) => x.moduleNumber)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(a.map((x) => x.outcomeCode)).toEqual(["CO1", "CO2", "CO3", "CO1", "CO2", "CO3"]);
  });
  it("CLASE keeps splitting by total hours (6 / 9 / 6)", () => {
    expect(generateTos(clase, "PRELIM", 50).rows.map((r) => r.questions)).toEqual([14, 22, 14]);
  });
});
