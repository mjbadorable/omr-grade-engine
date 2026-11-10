import { describe, expect, it } from "vitest";
import { analyzeItems } from "@/lib/grading/item-analysis";
import { rescoreBatch } from "@/lib/grading/scorer";
import { simulateClass, syntheticKey } from "@/lib/grading/simulate";
import type { ChoiceRule } from "@/lib/grading/types";
import { updateRule } from "@/lib/grading/answer-key";

describe("instant rescoring benchmark", () => {
  // 5,000 students × 100 questions, four sets with question-order AND option shuffles
  const key = syntheticKey(100, { seed: 21, sets: ["A", "B", "C", "D"], shuffle: true });
  const { scans } = simulateClass(key, { students: 5000, seed: 5, uncertainRate: 0.05 });

  it("rescores 5,000 shuffled-set sheets in < 2 s after a key change", () => {
    rescoreBatch(scans.slice(0, 50), key); // warm-up (JIT)
    const changed = updateRule(key, 17, { correct: [((key.questions.get(17) as ChoiceRule).correct[0] + 1) % 4] });
    const t0 = performance.now();
    const sheets = rescoreBatch(scans, changed);
    const ms = performance.now() - t0;
    console.log(`rescoreBatch: 5,000 sheets × 100 questions in ${ms.toFixed(0)} ms`);
    expect(sheets).toHaveLength(5000);
    expect(sheets.every((s) => s.keyVersion === changed.version)).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  it("set mapping is exact: a perfect student scores 100 % on every set", () => {
    const { scans: perfect } = simulateClass(key, { students: 8, seed: 2, perfect: true });
    const sheets = rescoreBatch(perfect, key);
    expect(new Set(sheets.map((s) => s.examSet))).toEqual(new Set(["A", "B", "C", "D"]));
    for (const s of sheets) expect(s).toMatchObject({ percentage: 100, correctCount: 100, incorrectCount: 0 });
  });

  it("item analysis over 5,000 sheets stays interactive (< 1.5 s)", () => {
    const sheets = rescoreBatch(scans, key);
    const t0 = performance.now();
    const rep = analyzeItems(sheets, key);
    const ms = performance.now() - t0;
    console.log(`analyzeItems: 5,000 × 100 in ${ms.toFixed(0)} ms (KR-20 ${rep.kr20})`);
    expect(rep.items).toHaveLength(100);
    expect(ms).toBeLessThan(1500);
  });
});
