import { describe, expect, it } from "vitest";
import { syntheticKey } from "@/lib/grading/simulate";
import { parseSyllabusText } from "@/lib/syllabus/parse-syllabus";
import { applyOutcomesToKey, assignOutcomes, distribute, generateTos, hasOutcomes, modulesForPeriod, resizeTos, setModuleQuestions } from "@/lib/syllabus/tos";
import { IT321_TEXT } from "./fixtures/it321";

const { syllabus } = parseSyllabusText(IT321_TEXT);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("distribute (largest remainder)", () => {
  it("always sums to the total and follows the weights", () => {
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distribute(100, [6, 9, 6])).toEqual([29, 43, 28]);
    expect(distribute(0, [1, 2])).toEqual([0, 0]);
    expect(distribute(7, [0, 0, 0])).toEqual([3, 2, 2]);
    for (const total of [1, 7, 50, 99, 100]) expect(sum(distribute(total, [3, 1, 4, 1, 5]))).toBe(total);
  });
});

describe("generateTos", () => {
  it("uses only the term's modules (Prelim 1–3, Midterm 4–6, Final 7–9)", () => {
    expect(modulesForPeriod(syllabus, "PRELIM").map((m) => m.number)).toEqual([1, 2, 3]);
    expect(modulesForPeriod(syllabus, "MIDTERM").map((m) => m.number)).toEqual([4, 5, 6]);
    expect(modulesForPeriod(syllabus, "FINAL").map((m) => m.number)).toEqual([7, 8, 9]);
  });

  it("splits questions by teaching hours and covers the total exactly", () => {
    const tos = generateTos(syllabus, "PRELIM", 50);
    // hours 6 / 9 / 6 → 14.3 / 21.4 / 14.3
    expect(tos.rows.map((r) => r.questions)).toEqual([14, 22, 14]);
    expect(sum(tos.rows.map((r) => r.questions))).toBe(50);
    expect(tos.rows[2].courseOutcomes).toEqual(["CO1", "CO4"]);
  });

  it("falls back to topic counts when hours are missing", () => {
    const noHours = { ...syllabus, modules: syllabus.modules.map(({ hours, ...m }) => { void hours; return m; }) };
    const tos = generateTos(noHours, "FINAL", 30);
    expect(sum(tos.rows.map((r) => r.questions))).toBe(30);
    expect(tos.rows.map((r) => r.moduleNumber)).toEqual([7, 8, 9]);
  });
});

describe("TOS sliders", () => {
  const tos = generateTos(syllabus, "PRELIM", 40);

  it("moving one slider rebalances the others and keeps the total", () => {
    const next = setModuleQuestions(tos, 1, 25);
    expect(next.rows[0].questions).toBe(25);
    expect(sum(next.rows.map((r) => r.questions))).toBe(40);
    expect(next.rows[1].questions).toBeGreaterThan(next.rows[2].questions - 1);
  });

  it("clamps to 0..total and handles a single-module term", () => {
    expect(setModuleQuestions(tos, 2, 999).rows.map((r) => r.questions)).toEqual([0, 40, 0]);
    expect(setModuleQuestions(tos, 2, -5).rows[1].questions).toBe(0);
    const one = { ...tos, rows: [tos.rows[0]] };
    expect(setModuleQuestions(one, 1, 3).rows[0].questions).toBe(40);
  });

  it("resizing keeps proportions", () => {
    const r = resizeTos(tos, 80);
    expect(r.totalQuestions).toBe(80);
    expect(sum(r.rows.map((x) => x.questions))).toBe(80);
  });
});

describe("assignOutcomes → answer key", () => {
  const tos = generateTos(syllabus, "PRELIM", 20);
  const assignments = assignOutcomes(tos, syllabus);

  it("numbers questions in module order and cycles each module's COs", () => {
    expect(assignments).toHaveLength(20);
    expect(assignments.map((a) => a.questionNumber)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const m3 = assignments.filter((a) => a.moduleNumber === 3).map((a) => a.outcomeCode);
    expect(new Set(m3)).toEqual(new Set(["CO1", "CO4"]));
    expect(assignments.filter((a) => a.moduleNumber === 1).every((a) => a.outcomeCode === "CO1")).toBe(true);
    const m3counts = [m3.filter((c) => c === "CO1").length, m3.filter((c) => c === "CO4").length];
    expect(Math.abs(m3counts[0] - m3counts[1])).toBeLessThanOrEqual(1);
  });

  it("stamps outcome + module on the key as one new version and leaves other questions alone", () => {
    const key = syntheticKey(25);
    const next = applyOutcomesToKey(key, assignments);
    expect(next.version).toBe(key.version + 1);
    expect(next.questions.get(1)).toMatchObject({ outcomeCode: "CO1", moduleNumber: 1 });
    expect(next.questions.get(20)?.outcomeCode).toBeTruthy();
    expect(next.questions.get(25)?.outcomeCode).toBeUndefined();
    expect(hasOutcomes(next)).toBe(true);
    expect(hasOutcomes(key)).toBe(false);
    expect(key.questions.get(1)?.outcomeCode).toBeUndefined();   // immutable
  });

  it("a module without COs falls back to the syllabus outcomes", () => {
    const bare = { ...syllabus, modules: syllabus.modules.map((m) => ({ ...m, courseOutcomes: [] })) };
    const a = assignOutcomes(generateTos(bare, "PRELIM", 8), bare);
    expect(a.every((x) => ["CO1", "CO2", "CO3", "CO4"].includes(x.outcomeCode!))).toBe(true);
  });
});

import { DEFAULT_SETTINGS } from "@/lib/omr/presets";
import { configureSheet, totalQuestions } from "@/lib/syllabus/sheet-config";

describe("configureSheet (designer auto-configuration)", () => {
  it("sets title/subtitle from the syllabus and matches the exam length to the TOS", () => {
    expect(totalQuestions(DEFAULT_SETTINGS)).toBe(100);
    const r = configureSheet(DEFAULT_SETTINGS, syllabus, "MIDTERM", 60);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.title).toBe("IT 321 Midterm Exam");
      expect(r.settings.subtitle).toBe("Information Assurance and Security 1 - 1st Semester, A.Y. 2025-2026");
      expect(totalQuestions(r.settings)).toBe(60);
      expect(DEFAULT_SETTINGS.sections[0].questionCount).toBe(100);   // input not mutated
    }
  });
  it("absorbs the difference in the first MCQ section only and refuses impossible sizes", () => {
    const mixed = { ...DEFAULT_SETTINGS, sections: [{ id: "n", name: "", type: "numeric" as const, questionCount: 2, digits: 4, hasSign: false, hasDecimal: false }, { id: "m", name: "", type: "mcq" as const, questionCount: 10, optionCount: 4, optionStyle: "letters" as const }] };
    const ok = configureSheet(mixed, syllabus, "FINAL", 30);
    expect(ok.ok && ok.settings.sections.map((s) => s.questionCount)).toEqual([2, 28]);
    expect(configureSheet(mixed, syllabus, "FINAL", 2).ok).toBe(false);
    expect(configureSheet(DEFAULT_SETTINGS, syllabus, "FINAL", 500).ok).toBe(false);
    const noMcq = { ...DEFAULT_SETTINGS, sections: [mixed.sections[0]] };
    expect(configureSheet(noMcq, syllabus, "FINAL", 9).ok).toBe(false);
  });
});
