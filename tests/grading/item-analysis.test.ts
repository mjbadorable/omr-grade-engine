import { describe, expect, it } from "vitest";
import { analyzeItems, kr20, pointBiserial } from "@/lib/grading/item-analysis";
import { rescoreBatch } from "@/lib/grading/scorer";
import { simulateClass, syntheticKey } from "@/lib/grading/simulate";
import type { AnswerKey, ChoiceRule, ScanInput } from "@/lib/grading/types";

/** Independent Pearson correlation (point-biserial must equal it for a 0/1 variable). */
function pearson(x: number[], y: number[]) {
  const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

// Hand-worked dataset: 5 students × 3 items, 1 point each, no penalty, key = A for every item.
//        i1 i2 i3  total
//   S1    1  1  1    3
//   S2    1  1  0    2
//   S3    1  0  1    2
//   S4    0  1  0    1
//   S5    0  0  0    0
const RESP = [[1, 1, 1], [1, 1, 0], [1, 0, 1], [0, 1, 0], [0, 0, 0]];
const L = ["A", "B", "C", "D"];
const handKey: AnswerKey = {
  examId: "hand", version: 3, sets: {}, defaultSet: null, gradeBands: [], conflictPolicy: "zero",
  questions: new Map([1, 2, 3].map((q) => [q, { type: "choice", questionNumber: q, optionCount: 4, optionLabels: L, correct: [0], mode: "ALL_MATCH", points: 1, negative: 0, bonus: false, dropped: false, tags: {} } satisfies ChoiceRule])),
};
const handScans: ScanInput[] = RESP.map((row, s) => ({
  sheetId: `S${s + 1}`,
  fields: {
    rollNumber: String(s + 1), rollDigits: [String(s + 1)], examSet: null, numeric: [], matrix: [], conflicts: [],
    // wrong answers: S2/S3 choose B, S4 chooses C, S5 leaves item 3 blank
    answers: row.map((ok, j) => {
      const marked = ok ? [0] : s === 4 && j === 2 ? [] : [s === 3 ? 2 : 1];
      return { questionNumber: j + 1, marked, labels: marked.map((i) => L[i]), uncertain: false };
    }),
  },
}));

describe("classical item statistics on a hand-worked dataset", () => {
  const sheets = rescoreBatch(handScans, handKey);
  const rep = analyzeItems(sheets, handKey);

  it("difficulty, 27 % groups and discrimination", () => {
    expect(rep.n).toBe(5);
    expect(rep.groupSize).toBe(1);                       // round(0.27 × 5)
    expect(rep.items.map((i) => i.p)).toEqual([0.6, 0.6, 0.4]);
    expect(rep.items.map((i) => i.d)).toEqual([1, 1, 1]); // S1 (upper) right on all, S5 (lower) wrong on all
    expect(rep.items[2].omitted).toBe(1);
  });

  it("point-biserial equals Pearson r and matches the closed form 0.8807", () => {
    const totals = [3, 2, 2, 1, 0];
    const col = RESP.map((r) => r[0]);
    expect(pointBiserial(col, totals)).toBeCloseTo(pearson(col, totals), 10);
    expect(rep.items[0].rpbis).toBeCloseTo(0.8807, 4);
    // corrected: correlate with the rest score
    const rest = totals.map((t, i) => t - col[i]);
    expect(rep.items[0].rpbisCorrected).toBeCloseTo(pearson(col, rest), 4);
  });

  it("KR-20 = 3/2 · (1 − 0.72/1.04) = 0.4615, with summary stats", () => {
    expect(kr20(RESP)).toBeCloseTo(1.5 * (1 - 0.72 / 1.04), 10);
    expect(rep.kr20).toBeCloseTo(0.4615, 4);
    expect(rep).toMatchObject({ mean: 1.6, median: 2, min: 0, max: 3, k: 3, keyVersion: 3 });
    expect(rep.sd).toBeCloseTo(Math.sqrt(1.04), 4);
    expect(rep.sem).toBeCloseTo(Math.sqrt(1.04) * Math.sqrt(1 - 0.4615), 3);
  });

  it("distractor table counts every option overall and per group", () => {
    const d = rep.items[0].distractors;
    expect(d.map((x) => [x.label, x.count, x.isKey])).toEqual([["A", 3, true], ["B", 1, false], ["C", 1, false], ["D", 0, false]]);
    expect(d[0]).toMatchObject({ upper: 1, lower: 0 });
    expect(d[3].flag).toBe("NON_FUNCTIONAL");
  });

  it("returns null statistics where they are undefined", () => {
    expect(kr20([[1, 1], [1, 1]])).toBeNull();          // zero variance
    expect(pointBiserial([1, 1, 1], [1, 2, 3])).toBeNull(); // everyone correct
  });
});

describe("item analysis on a simulated class (2PL IRT ground truth)", () => {
  const key = syntheticKey(40, { seed: 3 });
  const q5 = key.questions.get(5) as ChoiceRule;
  const trap = (q5.correct[0] + 1) % 4;
  const { scans, items } = simulateClass(key, { students: 800, seed: 11, traps: { 5: trap } });
  const rep = analyzeItems(rescoreBatch(scans, key), key);

  it("flags the miskeyed question red and blames the attracting distractor", () => {
    const s5 = rep.items.find((i) => i.questionNumber === 5)!;
    expect(s5.quality).toBe("POOR");
    expect(s5.flags).toEqual(expect.arrayContaining(["POSSIBLE_MISKEY", "NEGATIVE_DISCRIMINATION"]));
    expect(s5.d).toBeLessThan(0);
    expect(s5.distractors[trap].flag).toBe("MISLEADING");
    expect(rep.items.filter((i) => i.flags.includes("POSSIBLE_MISKEY")).map((i) => i.questionNumber)).toEqual([5]);
  });

  it("recovers the simulated discrimination ordering and yields a reliable test", () => {
    const rank = (xs: number[]) => xs.map((x) => xs.filter((y) => y < x).length);
    const valid = rep.items.filter((i) => i.questionNumber !== 5);
    const a = valid.map((i) => items.get(i.questionNumber)!.a);
    const r = pearson(rank(a), rank(valid.map((i) => i.rpbisCorrected!)));
    expect(r).toBeGreaterThan(0.5);                       // Spearman ρ between true a and observed r_pbis
    expect(rep.kr20!).toBeGreaterThan(0.8);
    expect(rep.items.filter((i) => i.quality === "STRONG").length).toBeGreaterThan(20);
  });
});
