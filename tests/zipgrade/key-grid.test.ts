import { describe, expect, it } from "vitest";
import { updateRule } from "@/lib/grading/answer-key";
import { correctPrinted, gridRows, toggleCorrect, toggleRowBubble } from "@/lib/grading/key-grid";
import { rescoreBatch, scoreSheet } from "@/lib/grading/scorer";
import { syntheticKey } from "@/lib/grading/simulate";
import type { AnswerKey, ChoiceRule, ScanInput } from "@/lib/grading/types";

const ch = (key: AnswerKey, q: number) => key.questions.get(q) as ChoiceRule;
const sheet = (answers: Record<number, number[]>, set: string | null = null): ScanInput => ({
  sheetId: "s", fields: { rollNumber: "1", rollDigits: ["1"], examSet: set, numeric: [], matrix: [], conflicts: [], answers: Object.entries(answers).map(([q, m]) => ({ questionNumber: +q, marked: m, labels: m.map((i) => "ABCD"[i]), uncertain: false })) },
});

describe("toggleCorrect: alternate credit", () => {
  const base = { ...ch(syntheticKey(3), 1), correct: [0], mode: "ALL_MATCH" as const };
  it("a second bubble switches to any-match; removing it switches back", () => {
    const two = toggleCorrect(base, 2);
    expect(two).toEqual({ correct: [0, 2], mode: "ANY_MATCH" });
    expect(toggleCorrect({ ...base, ...two }, 2)).toEqual({ correct: [0], mode: "ALL_MATCH" });
    expect(toggleCorrect(base, 0)).toEqual({ correct: [], mode: "ALL_MATCH" });
  });
  it("never overrides an explicit partial-credit choice", () => {
    expect(toggleCorrect({ ...base, mode: "PARTIAL_CREDIT" }, 1).mode).toBe("PARTIAL_CREDIT");
  });
});

describe("bubble key → live rescoring", () => {
  it("with A and C toggled on, either answer earns full points; others still fail", () => {
    const key0 = syntheticKey(2);
    let key = updateRule(key0, 1, { correct: [0], mode: "ALL_MATCH", points: 2, negative: 0 } as Partial<ChoiceRule>);
    const papers = [sheet({ 1: [0] }), sheet({ 1: [2] }), sheet({ 1: [1] })].map((p, i) => ({ ...p, sheetId: `p${i}` }));
    const before = rescoreBatch(papers, key).map((s) => s.items[0].scoreEarned + 0);
    expect(before).toEqual([2, 0, 0]);
    key = updateRule(key, 1, toggleCorrect(ch(key, 1), 2) as Partial<ChoiceRule>);       // click bubble C
    const after = rescoreBatch(papers, key).map((s) => s.items[0].scoreEarned + 0);
    expect(after).toEqual([2, 2, 0]);                                                      // A or C now correct
  });
  it("bonus gives every student full credit immediately", () => {
    const key = updateRule(syntheticKey(2), 2, { bonus: true, points: 3 });
    const s = scoreSheet(sheet({ 1: [0] }), key);
    expect(s.items.find((i) => i.questionNumber === 2)).toMatchObject({ scoreEarned: 3, notes: expect.arrayContaining(["BONUS"]) });
  });
});

describe("per-set key view", () => {
  const key = (() => {
    const k = syntheticKey(3, { sets: ["A", "B"] });
    const rules = new Map(k.questions);
    rules.set(1, { ...ch(k, 1), correct: [0] }); rules.set(2, { ...ch(k, 2), correct: [1] }); rules.set(3, { ...ch(k, 3), correct: [2] });
    // Set B: printed order is 3,1,2 and Q1's printed A,B,C,D are master D,A,B,C
    return { ...k, questions: rules, sets: { A: {}, B: { questionOrder: [3, 1, 2], optionPermutations: { 1: [3, 0, 1, 2] } } } };
  })();
  it("Set A rows are in master order; Set B rows follow the printed order and option shuffle", () => {
    expect(gridRows(key, "A").map((r) => r.master)).toEqual([1, 2, 3]);
    const b = gridRows(key, "B");
    expect(b.map((r) => [r.printed, r.master])).toEqual([[1, 3], [2, 1], [3, 2]]);
    const q1 = b.find((r) => r.master === 1)!;
    expect(correctPrinted(q1)).toEqual([1]);                // master A sits at printed B
  });
  it("clicking a printed bubble edits the right master option", () => {
    const q1 = gridRows(key, "B").find((r) => r.master === 1)!;
    const patch = toggleRowBubble(q1, 0) as Pick<ChoiceRule, "correct" | "mode">;   // printed A = master D
    expect(patch.correct).toEqual([0, 3]);
    expect(patch.mode).toBe("ANY_MATCH");
  });
});
