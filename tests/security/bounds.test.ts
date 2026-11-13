/**
 * Input bounds on the shared Zod schemas (templates, rosters, syllabi). They run in the browser and
 * inside Convex, so oversized or hostile payloads are refused before they are processed or stored,
 * while every sheet the designer can really produce still validates.
 */
import { describe, expect, it } from "vitest";
import { normalizeSettings } from "@/lib/omr/columns";
import { computeLayout } from "@/lib/omr/layout-engine";
import { DEFAULT_SETTINGS } from "@/lib/omr/presets";
import { OMRTemplateSchema } from "@/lib/omr/schema";
import { RosterSchema } from "@/lib/roster/schema";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import { parseSyllabusText } from "@/lib/syllabus/parse-syllabus";
import { SyllabusSchema } from "@/lib/syllabus/types";
import { IT321_TEXT } from "./../syllabus/fixtures/it321";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const kit = buildSampleExam();
const tpl = (mutate: (t: Any) => void) => { const t = structuredClone(kit.template) as Any; mutate(t); return t; };
const ok = (v: unknown) => OMRTemplateSchema.safeParse(v).success;
const fill = <T,>(item: T, n: number) => Array.from({ length: n }, () => structuredClone(item));
const mcqRegion = (t: Any) => t.pages[0].regions.find((r: Any) => r.kind === "mcq");

describe("templates: real sheets still validate", () => {
  it("the sample exam", () => expect(ok(kit.template)).toBe(true));

  it("the largest sheet the designer produces (1,240 questions over 45 pages)", () => {
    const mcq = (n: number, i: number) => ({ id: `m${i}`, name: "", type: "mcq" as const, questionCount: n, optionCount: 6, optionStyle: "letters" as const });
    const big = normalizeSettings({
      ...DEFAULT_SETTINGS, rollDigits: 10, examSets: 6, columns: 1,
      sections: [...Array.from({ length: 6 }, (_, i) => mcq(200, i)), { id: "n", name: "", type: "numeric", questionCount: 20, digits: 8, hasSign: true, hasDecimal: true }, { id: "x", name: "", type: "matrix", questionCount: 20, rows: 6, cols: 6 }],
    });
    expect(ok(computeLayout(big).template)).toBe(true);
  });
});

describe("templates: oversized or hostile payloads are refused", () => {
  it("too many pages", () => expect(ok(tpl((t) => { t.pages = fill(t.pages[0], 61); }))).toBe(false));
  it("too many texts, boxes or regions on a page", () => {
    expect(ok(tpl((t) => { t.pages[0].texts = fill(t.pages[0].texts[0], 501); }))).toBe(false);
    expect(ok(tpl((t) => { t.pages[0].boxes = fill(t.pages[0].boxes[0] ?? { id: "b", kind: "frame", bbox: { x: 0, y: 0, w: 1, h: 1 } }, 501); }))).toBe(false);
    expect(ok(tpl((t) => { t.pages[0].regions = fill(t.pages[0].regions[0], 201); }))).toBe(false);
  });
  it("too many questions in one region, or bubbles in one question", () => {
    expect(ok(tpl((t) => { const r = mcqRegion(t); r.questions = fill(r.questions[0], 401); }))).toBe(false);
    expect(ok(tpl((t) => { const q = mcqRegion(t).questions[0]; q.bubbles = fill(q.bubbles[0], 11); }))).toBe(false);
  });
  it("oversized reference grid", () => {
    expect(ok(tpl((t) => { t.pages[0].referenceGrid.rowYs = fill(0, 501); }))).toBe(false);
    expect(ok(tpl((t) => { t.pages[0].referenceGrid.columnXs = fill(0, 101); }))).toBe(false);
  });
  it("oversized strings", () => {
    expect(ok(tpl((t) => { t.title = "x".repeat(201); }))).toBe(false);
    expect(ok(tpl((t) => { t.pages[0].qr.matrix = "1".repeat(100_001); }))).toBe(false);
    expect(ok(tpl((t) => { t.pages[0].qr.payload = "x".repeat(2_001); }))).toBe(false);
    expect(ok(tpl((t) => { t.pages[0].regions[0].id = "x".repeat(121); }))).toBe(false);
  });
  it("an absurd question count", () => expect(ok(tpl((t) => { t.questionCount = 2_001; }))).toBe(false));
});

describe("rosters", () => {
  const student = (i: number) => ({ rollNumber: String(i), name: `Student ${i}` });
  const roster = (n: number) => ({ schema: "omr-roster/v1" as const, name: "Class", importedAt: 1, students: Array.from({ length: n }, (_, i) => student(i)) });
  it("accepts a school-sized class list", () => expect(RosterSchema.safeParse(roster(5_000)).success).toBe(true));
  it("refuses more than 5,000 students", () => expect(RosterSchema.safeParse(roster(5_001)).success).toBe(false));
  it("caps the length of every text field", () => {
    const one = (s: Record<string, unknown>) => RosterSchema.safeParse({ ...roster(1), students: [{ ...student(1), ...s }] }).success;
    expect(one({ name: "n".repeat(200) })).toBe(true);
    expect(one({ name: "n".repeat(201) })).toBe(false);
    expect(one({ rollNumber: "9".repeat(41) })).toBe(false);
    expect(one({ section: "s".repeat(101) })).toBe(false);
    expect(one({ phone: "1".repeat(51) })).toBe(false);
    expect(one({ guardianContact: "g".repeat(201) })).toBe(false);
    expect(one({ email: `${"a".repeat(250)}@x.ph` })).toBe(false);
    expect(RosterSchema.safeParse({ ...roster(1), name: "r".repeat(201) }).success).toBe(false);
  });
});

describe("syllabi", () => {
  const base = parseSyllabusText(IT321_TEXT).syllabus as Any;
  const syl = (m: (s: Any) => void) => { const s = structuredClone(base); m(s); return SyllabusSchema.safeParse(s).success; };
  it("a real parsed syllabus still validates", () => expect(SyllabusSchema.safeParse(base).success).toBe(true));
  it("caps list sizes", () => {
    expect(syl((s) => { s.programOutcomes = fill(s.programOutcomes[0], 27); })).toBe(false);
    expect(syl((s) => { s.courseOutcomes = fill(s.courseOutcomes[0], 31); })).toBe(false);
    expect(syl((s) => { s.modules = fill(s.modules[0], 41); })).toBe(false);
    expect(syl((s) => { s.modules[0].topics = fill("t", 201); })).toBe(false);
    expect(syl((s) => { s.gradingPolicy.components = fill(s.gradingPolicy.components[0] ?? { name: "x", weight: 1, group: "lecture" }, 31); })).toBe(false);
  });
  it("caps text lengths", () => {
    expect(syl((s) => { s.courseCode = "C".repeat(41); })).toBe(false);
    expect(syl((s) => { s.courseTitle = "T".repeat(301); })).toBe(false);
    expect(syl((s) => { s.term = "t".repeat(61); })).toBe(false);
    expect(syl((s) => { s.courseOutcomes[0].description = "d".repeat(4_001); })).toBe(false);
    expect(syl((s) => { s.modules[0].topics = ["t".repeat(501)]; })).toBe(false);
  });
});
