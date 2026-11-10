import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/omr/layout-engine";
import { PRESETS } from "@/lib/omr/presets";
import {
  formatSetMappingText, keyFromScannedAnswers, keyFromTemplate, parseKey, parseSetMappingText, serializeKey, updateAllRules, updateRule,
} from "@/lib/grading/answer-key";
import { mergePages, rescoreBatch, scoreSheet } from "@/lib/grading/scorer";
import type { AnswerKey, ChoiceRule, QuestionRule, ScanInput } from "@/lib/grading/types";
import type { DecodedFields } from "@/lib/vision/types";

const L = ["A", "B", "C", "D"];
const choice = (q: number, correct: number[], extra: Partial<ChoiceRule> = {}): QuestionRule => ({
  type: "choice", questionNumber: q, optionCount: 4, optionLabels: L, correct, mode: "ALL_MATCH",
  points: 4, negative: 1, bonus: false, dropped: false, tags: {}, ...extra,
});
const key = (rules: QuestionRule[], extra: Partial<AnswerKey> = {}): AnswerKey => ({
  examId: "t", version: 1, questions: new Map(rules.map((r) => [r.questionNumber, r])), sets: {}, defaultSet: null,
  gradeBands: [{ minPercent: 0, label: "F" }, { minPercent: 50, label: "C" }, { minPercent: 80, label: "A" }], conflictPolicy: "zero", ...extra,
});
/** answers: q → marked option indices (printed); "?" suffix in a string marks it uncertain */
function scan(answers: Record<number, number[] | { marked: number[]; uncertain: boolean }>, extra: Partial<DecodedFields> = {}): ScanInput {
  return {
    sheetId: "s1",
    fields: {
      rollNumber: "123", rollDigits: ["1", "2", "3"], examSet: null, numeric: [], matrix: [], conflicts: [],
      answers: Object.entries(answers).map(([q, a]) => {
        const v = Array.isArray(a) ? { marked: a, uncertain: false } : a;
        return { questionNumber: +q, marked: v.marked, labels: v.marked.map((i) => L[i]), uncertain: v.uncertain };
      }),
      ...extra,
    },
  };
}
const item = (s: ReturnType<typeof scoreSheet>, q: number) => s.items.find((i) => i.questionNumber === q)!;

describe("scoreSheet: marking schemes", () => {
  it("applies positive and negative marking, omissions and multiple marks", () => {
    const k = key([choice(1, [0]), choice(2, [1]), choice(3, [2]), choice(4, [3])]);
    const s = scoreSheet(scan({ 1: [0], 2: [0], 3: [], 4: [3, 2] }), k);
    expect(item(s, 1)).toMatchObject({ status: "CORRECT", scoreEarned: 4, isCorrect: true });
    expect(item(s, 2)).toMatchObject({ status: "INCORRECT", scoreEarned: -1 });
    expect(item(s, 3)).toMatchObject({ status: "OMITTED", scoreEarned: 0 });
    expect(item(s, 4)).toMatchObject({ status: "INCORRECT", scoreEarned: -1, notes: ["MULTIPLE_MARKS"] });
    expect(s).toMatchObject({ totalScore: 2, maxScore: 16, percentage: 12.5, correctCount: 1, incorrectCount: 2, omittedCount: 1, accuracy: 0.3333, grade: "F" });
  });

  it("supports ALL_MATCH / ANY_MATCH / PARTIAL_CREDIT on multi-correct questions", () => {
    const k = key([
      choice(1, [0, 2], { mode: "ALL_MATCH" }),
      choice(2, [0, 2], { mode: "ANY_MATCH" }),
      choice(3, [0, 1, 2], { mode: "PARTIAL_CREDIT", points: 6, negative: 2 }),
      choice(4, [0, 1, 2], { mode: "PARTIAL_CREDIT", points: 6, negative: 2 }),
      choice(5, [0, 2], { mode: "ANY_MATCH" }),
      choice(6, [0, 2], { mode: "ALL_MATCH" }),
    ]);
    const s = scoreSheet(scan({ 1: [0, 2], 2: [2], 3: [0, 1], 4: [0, 3], 5: [2, 3], 6: [0] }), k);
    expect(item(s, 1)).toMatchObject({ status: "CORRECT", scoreEarned: 4 });
    expect(item(s, 2)).toMatchObject({ status: "CORRECT", scoreEarned: 4 });
    expect(item(s, 3)).toMatchObject({ status: "PARTIAL", scoreEarned: 4, isCorrect: false }); // 6 × 2/3
    expect(item(s, 4)).toMatchObject({ status: "INCORRECT", scoreEarned: -2 });
    expect(item(s, 5)).toMatchObject({ status: "INCORRECT", scoreEarned: -1 });
    expect(item(s, 6)).toMatchObject({ status: "INCORRECT", scoreEarned: -1 });
    expect(item(s, 1).notes).toEqual([]);                  // two marks are legitimate on a 2-answer item
  });

  it("handles bonus, dropped and unkeyed questions", () => {
    const k = key([choice(1, [0], { bonus: true }), choice(2, [1], { dropped: true }), choice(3, []), choice(4, [3])]);
    const s = scoreSheet(scan({ 1: [3], 2: [1], 3: [0], 4: [3] }), k);
    expect(item(s, 1)).toMatchObject({ status: "CORRECT", scoreEarned: 4, notes: ["BONUS"] });
    expect(item(s, 2)).toMatchObject({ status: "OMITTED", scoreEarned: 0, maxScore: 0, notes: ["DROPPED"] });
    expect(item(s, 3)).toMatchObject({ status: "OMITTED", maxScore: 0, notes: ["UNKEYED"] });
    expect(s).toMatchObject({ totalScore: 8, maxScore: 8, percentage: 100, grade: "A" });
  });

  it("flags uncertain marks (zero policy) or scores the filled bubbles (score-filled policy)", () => {
    const answers = { 1: { marked: [0], uncertain: true }, 2: [1] };
    const k = key([choice(1, [0]), choice(2, [1])]);
    const flagged = scoreSheet(scan(answers), k);
    expect(item(flagged, 1)).toMatchObject({ status: "FLAGGED_CONFLICT", scoreEarned: 0, notes: ["UNCERTAIN_MARK"] });
    expect(flagged).toMatchObject({ flaggedCount: 1, totalScore: 4 });
    const lenient = scoreSheet(scan(answers), { ...k, conflictPolicy: "score-filled" });
    expect(item(lenient, 1)).toMatchObject({ status: "CORRECT", notes: ["UNCERTAIN_MARK"] });
  });

  it("scores numeric with tolerance and matrix rows (all or partial)", () => {
    const k = key([
      { type: "numeric", questionNumber: 1, value: 12.5, tolerance: 0.05, points: 4, negative: 0, bonus: false, dropped: false, tags: {} },
      { type: "numeric", questionNumber: 2, value: 3, tolerance: 0, points: 4, negative: 1, bonus: false, dropped: false, tags: {} },
      { type: "matrix", questionNumber: 3, rows: { A: ["P", "Q"], B: ["R"], C: ["S"], D: ["T"] }, mode: "PARTIAL_CREDIT", points: 8, negative: 0, bonus: false, dropped: false, tags: {} },
      { type: "matrix", questionNumber: 4, rows: { A: ["P"], B: ["Q"] }, mode: "ALL_MATCH", points: 2, negative: 0, bonus: false, dropped: false, tags: {} },
    ]);
    const s = scoreSheet(scan({}, {
      numeric: [{ questionNumber: 1, value: "12.54", uncertain: false }, { questionNumber: 2, value: "-3", uncertain: false }],
      matrix: [
        { questionNumber: 3, rows: { A: ["Q", "P"], B: ["R"], C: ["T"], D: [] }, uncertain: false },
        { questionNumber: 4, rows: { A: ["P"], B: ["Q"] }, uncertain: false },
      ],
    }), k);
    expect(item(s, 1)).toMatchObject({ status: "CORRECT", answerText: "12.54" });
    expect(item(s, 2)).toMatchObject({ status: "INCORRECT", scoreEarned: -1 });
    expect(item(s, 3)).toMatchObject({ status: "PARTIAL", scoreEarned: 4 });   // 2 of 4 rows exact
    expect(item(s, 4)).toMatchObject({ status: "CORRECT", scoreEarned: 2 });
  });

  it("assigns tiered grades and subject/section breakdowns", () => {
    const k = key([choice(1, [0], { tags: { subject: "Math", section: "I" } }), choice(2, [0], { tags: { subject: "Math", section: "II" } }), choice(3, [0], { tags: { subject: "Sci", section: "II" } })]);
    const s = scoreSheet(scan({ 1: [0], 2: [0], 3: [1] }), k);
    expect(s.percentage).toBe(58.33);
    expect(s.grade).toBe("C");
    expect(s.bySubject).toEqual({ Math: { score: 8, max: 8, correct: 2, total: 2 }, Sci: { score: -1, max: 4, correct: 0, total: 1 } });
    expect(s.bySection.II).toEqual({ score: 3, max: 8, correct: 1, total: 2 });
  });
});

describe("exam sets", () => {
  // master: Q1=A, Q2=B, Q3=C. Set B prints master Q3 first, Q1 second, Q2 third and shuffles Q1's options.
  const base = key([choice(1, [0]), choice(2, [1]), choice(3, [2])], {
    sets: { A: {}, B: { questionOrder: [3, 1, 2], optionPermutations: { 1: [3, 2, 1, 0] } } }, defaultSet: "A",
  });

  it("maps printed question order and option shuffles back to the master key", () => {
    // Set B student, all correct: printed Q1 = master Q3 → C ; printed Q2 = master Q1, master A printed as D ; printed Q3 = master Q2 → B
    const s = scoreSheet(scan({ 1: [2], 2: [3], 3: [1] }, { examSet: "B" }), base);
    expect(s.items.map((i) => [i.questionNumber, i.printedNumber, i.status])).toEqual([[1, 2, "CORRECT"], [2, 3, "CORRECT"], [3, 1, "CORRECT"]]);
    expect(item(s, 1).selectedLabels).toEqual(["A"]);
    // the same printed answers under Set A are mostly wrong
    expect(scoreSheet(scan({ 1: [2], 2: [3], 3: [1] }, { examSet: "A" }), base).correctCount).toBe(0);
  });

  it("refuses to guess when the set is unreadable and sets differ", () => {
    const s = scoreSheet(scan({ 1: [0] }, { examSet: null }), base);
    expect(s.sheetFlags).toContain("SET_UNKNOWN");
    expect(s.items.every((i) => i.status === "FLAGGED_CONFLICT")).toBe(true);
  });

  it("uses the default set when all sets share one layout", () => {
    const k = key([choice(1, [0])], { sets: { A: {}, B: {} }, defaultSet: "A" });
    expect(scoreSheet(scan({ 1: [0] }), k).correctCount).toBe(1);
  });

  it("parses and formats the set-mapping text format with validation", () => {
    const { mapping, errors } = parseSetMappingText("# set B\n1:3\n2:1:DCBA\n3:2", base);
    expect(errors).toEqual([]);
    expect(mapping).toEqual({ questionOrder: [3, 1, 2], optionPermutations: { 1: [3, 2, 1, 0] } });
    expect(formatSetMappingText(mapping)).toBe("1:3\n2:1:DCBA\n3:2");
    expect(parseSetMappingText("1:9\n2:1:AAB", base).errors.length).toBe(2);
  });
});

describe("answer key lifecycle", () => {
  const t = computeLayout({ templateId: "tpl-key", ...PRESETS[2].settings }).template; // MCQ + numeric + matrix
  it("builds a blank key from a template, edits immutably and bumps the version", () => {
    const k0 = keyFromTemplate(t);
    expect(k0.questions.size).toBe(t.questionCount);
    expect(Object.keys(k0.sets)).toEqual(["A", "B", "C", "D"]);
    const k1 = updateRule(k0, 1, { correct: [2] } as Partial<QuestionRule>);
    expect(k1.version).toBe(2);
    expect((k0.questions.get(1) as ChoiceRule).correct).toEqual([]);  // original untouched
    const k2 = updateAllRules(k1, { points: 4, negative: 1 }, (r) => r.type === "choice");
    expect([...k2.questions.values()].filter((r) => r.type === "choice").every((r) => r.points === 4 && r.negative === 1)).toBe(true);
  });

  it("round-trips through JSON and takes a key from a scanned master sheet", () => {
    let k = keyFromScannedAnswers(keyFromTemplate(t), scan({ 1: [1], 2: [3] }, {
      numeric: [{ questionNumber: 31, value: "-12.5", uncertain: false }],
      matrix: [{ questionNumber: 33, rows: { A: ["P"], B: [], C: [], D: [] }, uncertain: false }],
    }).fields);
    k = { ...k, sets: { ...k.sets, B: { questionOrder: [2, 1], optionPermutations: { 1: [1, 0, 3, 2] } } } };
    expect((k.questions.get(1) as ChoiceRule).correct).toEqual([1]);
    expect(k.questions.get(31)).toMatchObject({ value: -12.5 });
    const back = parseKey(JSON.parse(JSON.stringify(serializeKey(k))));
    expect(back).toEqual(k);
  });
});

describe("batches and pages", () => {
  it("rescoreBatch equals scoring sheets one by one", () => {
    const k = key([choice(1, [0]), choice(2, [1])]);
    const scans = [scan({ 1: [0], 2: [1] }), scan({ 1: [1] }), scan({})].map((s, i) => ({ ...s, sheetId: `s${i}` }));
    expect(rescoreBatch(scans, k)).toEqual(scans.map((s) => scoreSheet(s, k)));
  });

  it("merges a student's pages before scoring", () => {
    const p1 = scan({ 1: [0] });
    const p2: ScanInput = { fields: { ...scan({ 2: [1] }).fields, rollNumber: null, rollDigits: [], examSet: null } };
    const merged = mergePages([p1, p2], "student-123");
    expect(merged.fields.answers.map((a) => a.questionNumber)).toEqual([1, 2]);
    expect(merged.fields.rollNumber).toBe("123");
    expect(scoreSheet(merged, key([choice(1, [0]), choice(2, [1])])).correctCount).toBe(2);
  });
});
