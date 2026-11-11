/** Manual override scoring consistency (raw scans immutable, newest patch wins, audit trail). */
import { describe, expect, it } from "vitest";
import { rescoreBatch, scoreSheet } from "@/lib/grading/scorer";
import type { AnswerKey, ChoiceRule } from "@/lib/grading/types";
import { reconcile } from "@/lib/roster/reconcile";
import { applyOverrides, describePatch, effectivePatches, makePatch, type ManualOverridePatch } from "@/lib/review/overrides";
import type { DecodedFields } from "@/lib/vision/types";

const L = ["A", "B", "C", "D"];
const key: AnswerKey = {
  examId: "e", version: 1, sets: {}, defaultSet: null, gradeBands: [], conflictPolicy: "zero",
  questions: new Map([1, 2, 3].map((q) => [q, { type: "choice", questionNumber: q, optionCount: 4, optionLabels: L, correct: [q - 1], mode: "ALL_MATCH", points: 2, negative: 0, bonus: false, dropped: false, tags: {} } satisfies ChoiceRule])),
};
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const raw: DecodedFields = deepFreeze({
  rollNumber: null, rollDigits: [null, "2", "3"], examSet: null,
  answers: [
    { questionNumber: 1, marked: [0], labels: ["A"], uncertain: false },
    { questionNumber: 2, marked: [], labels: [], uncertain: true },       // partial mark → flagged
    { questionNumber: 3, marked: [1, 2], labels: ["B", "C"], uncertain: false },
  ],
  numeric: [], matrix: [],
  conflicts: [
    { code: "ROLL_DIGIT_BLANK", field: "roll", index: 0, bubbleIds: [], message: "" },
    { code: "ANSWER_UNCERTAIN", field: "answer", index: 2, bubbleIds: [], message: "" },
    { code: "ANSWER_MULTIPLE", field: "answer", index: 3, bubbleIds: [], message: "" },
  ],
});
const P = (over: Partial<ManualOverridePatch> & Pick<ManualOverridePatch, "target" | "questionNumber" | "overriddenOption">, ts: number, id = `p${ts}`): ManualOverridePatch =>
  makePatch({ sheetId: "s", originalState: {}, reason: "checked paper", teacherId: "t1", ...over, timestamp: ts, id });

describe("applyOverrides", () => {
  it("never mutates the scanner result and is a no-op without patches", () => {
    expect(applyOverrides(raw, [])).toBe(raw);
    expect(() => applyOverrides(raw, [P({ target: "answer", questionNumber: 2, overriddenOption: [1] }, 1)])).not.toThrow();
    expect(raw.answers[1].marked).toEqual([]);
  });

  it("resolves a flagged answer and rescoring follows in real time", () => {
    const before = scoreSheet({ sheetId: "s", fields: raw }, key);
    expect(before.items[1].status).toBe("FLAGGED_CONFLICT");
    const fixed = applyOverrides(raw, [P({ target: "answer", questionNumber: 2, overriddenOption: [1] }, 1)]);
    const after = scoreSheet({ sheetId: "s", fields: fixed }, key);
    expect(after.items[1]).toMatchObject({ status: "CORRECT", scoreEarned: 2 });
    expect(after.totalScore).toBe(before.totalScore + 2);
    expect(fixed.conflicts.map((c) => c.code)).toEqual(["ROLL_DIGIT_BLANK", "ANSWER_MULTIPLE"]);
  });

  it("newest patch per target wins; equal timestamps break ties by id; null reverts", () => {
    const patches = [
      P({ target: "answer", questionNumber: 3, overriddenOption: [2] }, 10, "b"),
      P({ target: "answer", questionNumber: 3, overriddenOption: [0] }, 5, "z"),   // older
      P({ target: "answer", questionNumber: 3, overriddenOption: [3] }, 10, "a"),  // same ts, smaller id
    ];
    expect(applyOverrides(raw, patches).answers[2].marked).toEqual([2]);
    // order of the patch log does not matter
    expect(applyOverrides(raw, [...patches].reverse()).answers[2].marked).toEqual([2]);
    const reverted = applyOverrides(raw, [...patches, P({ target: "answer", questionNumber: 3, overriddenOption: null }, 20)]);
    expect(reverted.answers[2]).toEqual(raw.answers[2]);
    expect(effectivePatches(patches).size).toBe(1);
  });

  it("roll-number override unlocks roster matching; set override drives set mapping", () => {
    const fixed = applyOverrides(raw, [P({ target: "roll", questionNumber: 0, overriddenOption: "123" }, 1), P({ target: "set", questionNumber: 0, overriddenOption: "B" }, 2)]);
    expect(fixed).toMatchObject({ rollNumber: "123", examSet: "B" });
    expect(fixed.conflicts.some((c) => c.field === "roll")).toBe(false);
    const r = reconcile({ schema: "omr-roster/v1", name: "", importedAt: 0, students: [{ rollNumber: "0123", name: "Ana" }] }, [{ sheetId: "s", rollNumber: fixed.rollNumber }]);
    expect(r.summary.matched).toBe(1);
  });

  it("batch rescoring with overrides equals per-sheet scoring", () => {
    const patches = [P({ target: "answer", questionNumber: 2, overriddenOption: [1] }, 1)];
    const inputs = ["s1", "s2"].map((id, i) => ({ sheetId: id, fields: i ? applyOverrides(raw, patches) : raw }));
    expect(rescoreBatch(inputs, key)).toEqual(inputs.map((x) => scoreSheet(x, key)));
  });

  it("describes patches for the audit log", () => {
    const p = P({ target: "answer", questionNumber: 2, overriddenOption: [1], originalState: { labels: [], uncertain: true } }, Date.UTC(2026, 10, 10, 8, 30));
    expect(describePatch(p)).toBe("2026-11-10 08:30 · t1: Q2 blank → B (“checked paper”)");
  });
});
