import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { analyzeItems } from "@/lib/grading/item-analysis";
import { rescoreBatch } from "@/lib/grading/scorer";
import { simulateClass, syntheticKey } from "@/lib/grading/simulate";
import type { AnswerKey, ScanInput } from "@/lib/grading/types";
import { computeAttainment } from "@/lib/syllabus/attainment";
import { parseSyllabusText } from "@/lib/syllabus/parse-syllabus";
import { makePlan, readStoredPlan, writeStoredPlan } from "@/lib/syllabus/plan-store";
import { buildAccreditationReport, reliabilityLabel } from "@/lib/syllabus/report";
import { applyOutcomesToKey, assignOutcomes, generateTos } from "@/lib/syllabus/tos";
import { IT321_TEXT } from "./fixtures/it321";

const { syllabus } = parseSyllabusText(IT321_TEXT);

/** 8 questions: Q1–4 → CO1, Q5–6 → CO2, Q7 → CO3, Q8 unmapped. 1 point each, no penalty. */
function keyWithOutcomes(): AnswerKey {
  const base = syntheticKey(8);
  const questions = new Map(base.questions);
  for (const [n, r] of questions) {
    const outcomeCode = n <= 4 ? "CO1" : n <= 6 ? "CO2" : n === 7 ? "CO3" : undefined;
    questions.set(n, { ...r, points: 1, negative: 0, ...(outcomeCode ? { outcomeCode } : {}) });
  }
  return { ...base, questions };
}
/** A sheet that answers exactly the given questions correctly. */
function sheet(key: AnswerKey, id: string, correct: number[]): ScanInput {
  const answers = [...key.questions.values()].map((r) => {
    const good = r.type === "choice" ? r.correct[0] : 0;
    const marked = correct.includes(r.questionNumber) ? [good] : [(good + 1) % 4];
    return { questionNumber: r.questionNumber, marked, labels: ["ABCD"[marked[0]]], uncertain: false };
  });
  return { sheetId: id, fields: { rollNumber: id, rollDigits: [], examSet: null, answers, numeric: [], matrix: [], conflicts: [] } };
}

describe("computeAttainment", () => {
  const key = keyWithOutcomes();
  // student A: all CO1, none else; student B: CO1 half, CO2 all, CO3 none
  const scans = [sheet(key, "a", [1, 2, 3, 4]), sheet(key, "b", [1, 2, 5, 6])];
  const scored = rescoreBatch(scans, key);
  const r = computeAttainment(scored, key, syllabus);

  it("computes points scored ÷ points possible per CO", () => {
    const co = Object.fromEntries(r.courseOutcomes.map((c) => [c.code, c]));
    expect(co.CO1).toMatchObject({ earned: 6, possible: 8, percent: 75, items: 4, met: true });     // exactly at target counts as met
    expect(co.CO2).toMatchObject({ earned: 2, possible: 4, percent: 50, met: false });
    expect(co.CO3).toMatchObject({ earned: 0, possible: 2, percent: 0, met: false });
    expect(co.CO4).toMatchObject({ items: 0, percent: null, met: null });
  });

  it("flags outcomes below the 75% target and counts unmapped questions", () => {
    expect(r.target).toBe(75);
    expect(r.belowTarget).toEqual(["CO2", "CO3"]);
    expect(r.unmappedItems).toBe(1);
    expect(r.n).toBe(2);
  });

  it("rolls COs up to POs, point-weighted, only for measured COs", () => {
    const po = Object.fromEntries(r.programOutcomes.map((p) => [p.code, p]));
    // CO1 → A,E ; CO2 → B,E ; CO3 → A,C,I
    expect(po.A).toMatchObject({ contributingCOs: ["CO1", "CO3"], earned: 6, possible: 10, percent: 60, met: false });
    expect(po.B).toMatchObject({ contributingCOs: ["CO2"], percent: 50 });
    expect(po.E).toMatchObject({ contributingCOs: ["CO1", "CO2"], earned: 8, possible: 12, percent: 66.7 });
    expect(po.H.percent).toBeNull();               // CO4 not measured
    expect(po.D.percent).toBeNull();
  });

  it("excludes bonus and dropped questions", () => {
    const qs = new Map(key.questions);
    qs.set(1, { ...qs.get(1)!, bonus: true });
    qs.set(2, { ...qs.get(2)!, dropped: true });
    const k2: AnswerKey = { ...key, questions: qs };
    const r2 = computeAttainment(rescoreBatch(scans, k2), k2, syllabus);
    expect(r2.courseOutcomes.find((c) => c.code === "CO1")).toMatchObject({ items: 2, possible: 4 });
  });

  it("works without a syllabus (codes only) and with no sheets", () => {
    const bare = computeAttainment(scored, key, null);
    expect(bare.courseOutcomes.map((c) => c.code)).toEqual(["CO1", "CO2", "CO3"]);
    expect(bare.programOutcomes).toEqual([]);
    const empty = computeAttainment([], key, syllabus);
    expect(empty.courseOutcomes.every((c) => c.percent === null)).toBe(true);
    expect(empty.belowTarget).toEqual([]);
  });

  it("clamps a CO whose negative marking pushes the cohort below zero", () => {
    const k0 = keyWithOutcomes();
    const k3: AnswerKey = { ...k0, questions: new Map([...k0.questions].map(([n, q]) => [n, { ...q, negative: 5 }])) };
    const allWrong = rescoreBatch([sheet(k3, "w", [])], k3);
    const co1 = computeAttainment(allWrong, k3, syllabus).courseOutcomes.find((c) => c.code === "CO1")!;
    expect(co1.percent).toBe(0);
    expect(co1.earned).toBe(0);
  });
});

describe("TOS → key → attainment end to end", () => {
  it("a 40-item Prelim exam covers CO1, CO2 and CO4 only; cohort attainment is reported per CO", () => {
    const tos = generateTos(syllabus, "PRELIM", 40);
    const key = applyOutcomesToKey(syntheticKey(40), assignOutcomes(tos, syllabus));
    const { scans } = simulateClass(key, { students: 60, seed: 4 });
    const report = computeAttainment(rescoreBatch(scans, key), key, syllabus);
    const measured = report.courseOutcomes.filter((c) => c.percent !== null).map((c) => c.code);
    expect(measured).toEqual(["CO1", "CO2", "CO4"]);
    expect(report.courseOutcomes.find((c) => c.code === "CO3")?.percent).toBeNull();
    expect(report.unmappedItems).toBe(0);
  });
});

describe("accreditation report", () => {
  it("builds a valid PDF pairing psychometrics with outcome attainment", async () => {
    const key = applyOutcomesToKey(syntheticKey(40), assignOutcomes(generateTos(syllabus, "PRELIM", 40), syllabus));
    const { scans } = simulateClass(key, { students: 40, seed: 2 });
    const scored = rescoreBatch(scans, key);
    const bytes = await buildAccreditationReport({
      institute: "University of San Agustin", examName: "IT 321 Prelim – “Exam” ≥ 50", period: "PRELIM", syllabus,
      psychometrics: analyzeItems(scored, key), attainment: computeAttainment(scored, key, syllabus), generatedAt: new Date("2026-01-05T00:00:00Z"),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain("Accreditation report");
  });

  it("labels KR-20 reliability", () => {
    expect([0.95, 0.85, 0.75, 0.65, 0.4, null].map(reliabilityLabel)).toEqual(["excellent", "good", "acceptable", "marginal", "poor", "not computable"]);
  });
});

describe("plan store", () => {
  it("round-trips a plan and rejects corrupt data", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    expect(readStoredPlan(storage)).toBeNull();
    const plan = makePlan(syllabus, "MIDTERM", generateTos(syllabus, "MIDTERM", 30), { templateId: "tpl-1", now: 123 });
    writeStoredPlan(plan, storage);
    const back = readStoredPlan(storage)!;
    expect(back.period).toBe("MIDTERM");
    expect(back.templateId).toBe("tpl-1");
    expect(back.assignments).toHaveLength(30);
    expect(back.syllabus.courseCode).toBe("IT 321");
    mem.set("omr:syllabusPlan", "{not json");
    expect(readStoredPlan(storage)).toBeNull();
    writeStoredPlan(null, storage);
    expect(mem.size).toBe(0);
  });
});
