import { describe, expect, it } from "vitest";
import { parseSyllabusText } from "@/lib/syllabus/parse-syllabus";
import { PERIOD_TAB_LABEL, SyllabusSchema } from "@/lib/syllabus/types";
import { IT321_TEXT } from "./fixtures/it321";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = () => structuredClone(parseSyllabusText(IT321_TEXT).syllabus) as Any;
const ok = (s: Any) => SyllabusSchema.safeParse(s).success;

describe("SyllabusSchema: backwards compatible", () => {
  it("still accepts a plain CLASE syllabus with none of the new fields", () => {
    expect(ok(base())).toBe(true);
  });
  it("accepts module 0 (orientation) and every new optional field", () => {
    const s = base();
    s.modules.unshift({
      number: 0, title: "Orientation", topics: [], courseOutcomes: [], period: "PRELIM", assessed: false,
      learningOutcomes: [{ code: "LO 0.1", description: "Know the vision and mission." }],
      lecture: { tla: ["Discussion"], assessments: [] },
    });
    s.modules[1].lecture = { tla: ["Lecture discussion"], assessments: ["Quiz"], hours: 2 };
    s.modules[1].lab = { tla: ["Machine Activity 1"], assessments: ["Graded"], hours: 6 };
    s.courseOutcomes[0].agaLinks = ["B", "C"];
    s.overview = { college: "College of Business", department: "Department of Hospitality Management", program: "BSHM", courseLevel: "Second Year Level", creditUnits: "2 units/lec; 3 units/lab" };
    s.graduateAttributes = [{ code: "A", description: "A transformative community builder oriented towards God." }];
    s.exams = [{ period: "PRELIM", title: "Prelim Examination", hours: 3, coverage: [1, 2] }];
    expect(ok(s)).toBe(true);
  });
  it("rejects a negative module number but allows 0", () => {
    const s = base(); s.modules[0].number = -1; expect(ok(s)).toBe(false);
    const z = base(); z.modules[0].number = 0; expect(ok(z)).toBe(true);
  });
});

describe("SyllabusSchema: new fields are bounded", () => {
  const withMod = (m: (mod: Any) => void) => { const s = base(); m(s.modules[0]); return ok(s); };
  it("caps learning outcomes, TLA and assessment lists", () => {
    expect(withMod((m) => { m.learningOutcomes = Array.from({ length: 41 }, (_, i) => ({ code: `LO ${i}`, description: "x" })); })).toBe(false);
    expect(withMod((m) => { m.learningOutcomes = [{ code: "L".repeat(21), description: "x" }]; })).toBe(false);
    expect(withMod((m) => { m.learningOutcomes = [{ code: "LO 1", description: "d".repeat(501) }]; })).toBe(false);
    expect(withMod((m) => { m.lecture = { tla: Array.from({ length: 21 }, () => "t"), assessments: [] }; })).toBe(false);
    expect(withMod((m) => { m.lab = { tla: [], assessments: ["a".repeat(201)] }; })).toBe(false);
    expect(withMod((m) => { m.lab = { tla: [], assessments: [], hours: -1 }; })).toBe(false);
  });
  it("caps overview text, attributes, exams and AGA links", () => {
    const top = (m: (s: Any) => void) => { const s = base(); m(s); return ok(s); };
    expect(top((s) => { s.overview = { college: "c".repeat(121) }; })).toBe(false);
    expect(top((s) => { s.graduateAttributes = Array.from({ length: 27 }, (_, i) => ({ code: String.fromCharCode(65 + (i % 26)), description: "x" })); })).toBe(false);
    expect(top((s) => { s.exams = Array.from({ length: 7 }, () => ({ period: "PRELIM", title: "t", coverage: [1] })); })).toBe(false);
    expect(top((s) => { s.exams = [{ period: "SEMIFINAL", title: "t", coverage: [1] }]; })).toBe(false);
    expect(top((s) => { s.courseOutcomes[0].agaLinks = ["ab"]; })).toBe(false);
  });
  it("refuses a syllabus whose serialized size would not fit a Convex document", () => {
    const s = base();
    s.modules = Array.from({ length: 40 }, (_, i) => ({
      number: i + 1, title: "t", topics: Array.from({ length: 200 }, () => "x".repeat(500)), courseOutcomes: [], period: "PRELIM",
    }));
    expect(ok(s)).toBe(false);
  });
});

describe("period labels", () => {
  it("shows the internal FINAL period as FINALS on tabs while keeping the stored value", () => {
    expect(PERIOD_TAB_LABEL).toEqual({ PRELIM: "PRELIM", MIDTERM: "MIDTERM", FINAL: "FINALS" });
  });
});
