import { describe, expect, it } from "vitest";
import { buildBreakdown, coverageLabel } from "@/lib/syllabus/breakdown";
import { parseSyllabusPages, parseSyllabusText, type PdfPageItems } from "@/lib/syllabus/parse-syllabus";
import fixture from "./fixtures/hm5-items.json";
import { IT321_TEXT } from "./fixtures/it321";

const pages = (): PdfPageItems[] => (fixture.pages as { width: number; height: number; items: [string, number, number, number, number][] }[])
  .map((p) => ({ width: p.width, height: p.height, items: p.items.map(([str, x, y, w, size]) => ({ str, x, y, w, size })) }));
const hm5 = buildBreakdown(parseSyllabusPages(pages(), { fileName: "1st Sem AY 2025-2026 UPDATED-HM5.pdf" }).syllabus);
const clase = buildBreakdown(parseSyllabusText(IT321_TEXT).syllabus);

describe("buildBreakdown: HM 5/HM5A (COB format)", () => {
  it("has a course overview card model", () => {
    expect(hm5.overview).toMatchObject({
      title: "Applied Business Tools & Technologies in Hospitality", code: "HM5/HM5A", term: "1st Sem AY 2025-2026",
      college: "College of Business", department: "Department of Hospitality Management", courseLevel: "Second Year Level", creditUnits: "2 units/lec; 3 units/lab",
    });
    expect(hm5.programOutcomes.total).toBe(8);
    expect(hm5.programOutcomes.codes).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(hm5.courseOutcomes.map((c) => c.code)).toEqual(["CO1", "CO2", "CO3"]);
  });
  it("groups modules into PRELIM / MIDTERM / FINALS tabs in that order", () => {
    expect(hm5.terms.map((t) => [t.period, t.label])).toEqual([["PRELIM", "PRELIM"], ["MIDTERM", "MIDTERM"], ["FINAL", "FINALS"]]);
    expect(hm5.terms.map((t) => t.modules.map((m) => m.number))).toEqual([[0, 1, 2], [3, 4], [5, 6]]);
  });
  it("counts modules, assessed modules and exams for the summary pill", () => {
    const [prelim, midterm, finals] = hm5.terms;
    expect([prelim.moduleCount, prelim.assessedCount, prelim.examCount]).toEqual([3, 2, 1]);
    expect(prelim.summary).toBe("3 modules · 2 assessed modules · 1 exam");
    expect(midterm.summary).toBe("2 modules · 2 assessed modules · 1 exam");
    expect(finals.summary).toBe("2 modules · 2 assessed modules · 1 exam");
  });
  it("marks M0 as the orientation module and the rest as assessed", () => {
    const m = hm5.terms[0].modules;
    expect(m[0]).toMatchObject({ number: 0, kind: "orientation", label: "M0" });
    expect(m[1]).toMatchObject({ number: 1, kind: "assessed", label: "M1", lectureHours: 2, labHours: 6, totalHours: 8 });
  });
  it("describes each period's examination banner and coverage bar", () => {
    const prelim = hm5.terms[0].exam!;
    expect(prelim).toMatchObject({ title: "Prelim Examination", hours: 3, coverageText: "M1–M2" });
    expect(hm5.terms[1].exam!.coverageText).toBe("M1–M4");
    expect(hm5.terms[2].exam!.coverageText).toBe("M1–M6");
    expect(prelim.bar.map((b) => [b.label, b.covered])).toEqual([["M1", true], ["M2", true], ["M3", false], ["M4", false], ["M5", false], ["M6", false]]);
  });
});

describe("buildBreakdown: CLASE format (no extra data) still renders", () => {
  it("derives terms from module periods and a coverage of the period's own modules", () => {
    expect(clase.terms.map((t) => t.modules.map((m) => m.number))).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(clase.terms[0].summary).toBe("3 modules · 3 assessed modules · 1 exam");
    expect(clase.terms[0].exam).toMatchObject({ coverageText: "M1–M3", derived: true });
    expect(clase.terms[0].exam?.hours).toBeUndefined();
    expect(clase.overview.college).toBeUndefined();
    expect(clase.overview.code).toBe("IT 321");
  });
});

describe("coverageLabel", () => {
  it("collapses runs and keeps gaps", () => {
    expect(coverageLabel([1, 2, 3, 4])).toBe("M1–M4");
    expect(coverageLabel([1, 2, 4])).toBe("M1–M2, M4");
    expect(coverageLabel([3])).toBe("M3");
    expect(coverageLabel([])).toBe("");
    expect(coverageLabel([4, 1, 2])).toBe("M1–M2, M4");
  });
});
