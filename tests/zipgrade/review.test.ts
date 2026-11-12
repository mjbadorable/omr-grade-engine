import { describe, expect, it } from "vitest";
import { distributionRows, dominantDistractor } from "@/lib/grading/item-distribution";
import { paperBubbles } from "@/lib/grading/paper-review";
import { scoreSheet } from "@/lib/grading/scorer";
import { syntheticKey } from "@/lib/grading/simulate";
import type { ChoiceRule, ItemStatistics } from "@/lib/grading/types";
import { instantResult, summarizeScored } from "@/lib/scan-result";
import { AutoSnapGate } from "@/lib/vision/auto-snap";
import type { DecodedFields } from "@/lib/vision/types";

const labels = ["A", "B", "C", "D"];
const item = (selected: number[], correct: number[], status: "CORRECT" | "INCORRECT" | "OMITTED" = "INCORRECT", notes: string[] = []) => ({ selected, correct, isCorrect: status === "CORRECT", status, notes: notes as never });

describe("paper review colours", () => {
  it("green = marked the correct bubble", () => {
    expect(paperBubbles(item([1], [1], "CORRECT"), { optionLabels: labels }).map((b) => b.visual)).toEqual(["plain", "correct-marked", "plain", "plain"]);
  });
  it("red = marked a wrong bubble, and the real answer gets the gold ring", () => {
    expect(paperBubbles(item([0], [2]), { optionLabels: labels }).map((b) => b.visual)).toEqual(["wrong-marked", "plain", "missed-correct", "plain"]);
  });
  it("skipped item: gold ring on the correct bubble, nothing red", () => {
    expect(paperBubbles(item([], [3], "OMITTED"), { optionLabels: labels }).map((b) => b.visual)).toEqual(["plain", "plain", "plain", "missed-correct"]);
  });
  it("multi-correct partly answered: green for the hit, gold for the one missed", () => {
    expect(paperBubbles(item([0], [0, 2]), { optionLabels: labels }).map((b) => b.visual)).toEqual(["correct-marked", "plain", "missed-correct", "plain"]);
  });
  it("bonus items show no gold ring (everyone gets the points)", () => {
    expect(paperBubbles(item([0], [2], "INCORRECT", ["BONUS"]), { optionLabels: labels }).some((b) => b.visual === "missed-correct")).toBe(false);
  });
  it("shows options in printed order when the set shuffles them", () => {
    // printed A,B,C,D = master C,A,B,D; student marked printed B (= master A), correct is master C (= printed A)
    const b = paperBubbles(item([0], [2]), { optionLabels: labels }, [2, 0, 1, 3]);
    expect(b.map((x) => x.visual)).toEqual(["missed-correct", "wrong-marked", "plain", "plain"]);
    expect(b.map((x) => x.label)).toEqual(["A", "B", "C", "D"]);     // labelled by printed position
  });
});

describe("distractor distribution", () => {
  const stat = (counts: number[], keyIdx: number, omitted: number, n = 100): Pick<ItemStatistics, "n" | "omitted" | "distractors"> => ({
    n, omitted,
    distractors: counts.map((count, i) => ({ optionIndex: i, label: labels[i], isKey: i === keyIdx, count, upper: 0, lower: 0, proportion: count / n, upperProportion: 0, lowerProportion: 0, flag: null })),
  });
  it("lists A–D and Blank with exact counts and shares", () => {
    const rows = distributionRows(stat([40, 35, 10, 10], 0, 5));
    expect(rows.map((r) => [r.label, r.count, Math.round(r.pct * 100)])).toEqual([["A", 40, 40], ["B", 35, 35], ["C", 10, 10], ["D", 10, 10], ["Blank", 5, 5]]);
  });
  it("key is green, wrong options above 30 % are warned, above 50 % are high", () => {
    expect(distributionRows(stat([40, 35, 10, 10], 0, 5)).map((r) => r.level)).toEqual(["key", "warn", "ok", "ok", "blank"]);
    expect(distributionRows(stat([20, 55, 10, 5], 0, 10)).map((r) => r.level)).toEqual(["key", "high", "ok", "ok", "blank"]);
    expect(distributionRows(stat([30, 30, 20, 20], 0, 0))[1].level).toBe("ok");        // exactly 30 % is not above the threshold
  });
  it("finds the dominant distractor", () => {
    expect(dominantDistractor(distributionRows(stat([20, 55, 10, 5], 0, 10)))?.label).toBe("B");
    expect(dominantDistractor(distributionRows(stat([70, 10, 10, 5], 0, 5)))).toBeNull();
  });
});

describe("instant result", () => {
  const key = (() => { const k = syntheticKey(4); const q = new Map(k.questions); for (const [n, r] of q) q.set(n, { ...(r as ChoiceRule), correct: [0], points: 1, negative: 0 }); return { ...k, questions: q }; })();
  const f = (answers: number[][], roll: string | null = "240101", set: string | null = "B"): DecodedFields => ({
    rollNumber: roll, rollDigits: [], examSet: set, numeric: [], matrix: [], conflicts: [],
    answers: answers.map((m, i) => ({ questionNumber: i + 1, marked: m, labels: m.map((x) => labels[x]), uncertain: false })),
  });
  it("reports ID, set, score text, double-marked and blank counts", () => {
    const r = instantResult(f([[0], [0], [1], [0, 1]]), key);
    expect(r).toMatchObject({ rollNumber: "240101", examSet: "B", keyed: true, score: 2, max: 4, scoreText: "2 / 4 (50.0%)", doubleMarked: 1, blank: 0, flagged: 1 });
    expect(instantResult(f([[0], [], [], [0]]), key)).toMatchObject({ blank: 2, flagged: 2, scoreText: "2 / 4 (50.0%)" });
  });
  it("formats the 42 / 50 example", () => {
    const k = syntheticKey(50); const q = new Map(k.questions); for (const [n, r] of q) q.set(n, { ...(r as ChoiceRule), correct: [0], points: 1, negative: 0 });
    const answers = Array.from({ length: 50 }, (_, i) => (i < 42 ? [0] : [1]));
    expect(summarizeScored(scoreSheet({ fields: f(answers) }, { ...k, questions: q })).scoreText).toBe("42 / 50 (84.0%)");
  });
  it("without a usable key it says so instead of showing 0%", () => {
    expect(instantResult(f([[0]]), null).scoreText).toBe("No answer key yet");
    expect(instantResult(f([[0]]), syntheticKey(1)).keyed).toBe(true);
  });
});

describe("Auto-Snap gate", () => {
  it("snaps once when aligned and steady, then waits for the sheet to leave", () => {
    const g = new AutoSnapGate({ minIntervalMs: 1000, framesToRearm: 3 });
    expect(g.update({ aligned: true, stable: false, now: 0 })).toBe(false);          // not steady yet
    expect(g.update({ aligned: true, stable: true, now: 100 })).toBe(true);          // snap
    expect(g.update({ aligned: true, stable: true, now: 300 })).toBe(false);         // same sheet: no double scan
    expect(g.update({ aligned: true, stable: true, now: 5000 })).toBe(false);        // still the same sheet
    for (let i = 0; i < 3; i++) g.update({ aligned: false, stable: false, now: 6000 + i });   // paper removed
    expect(g.update({ aligned: true, stable: true, now: 8000 })).toBe(true);         // next sheet
  });
  it("does not snap while a scan is running, and rearm() reopens it", () => {
    const g = new AutoSnapGate({ minIntervalMs: 0 });
    expect(g.update({ aligned: true, stable: true, busy: true, now: 0 })).toBe(false);
    expect(g.update({ aligned: true, stable: true, now: 10 })).toBe(true);
    g.rearm();
    expect(g.update({ aligned: true, stable: true, now: 20 })).toBe(true);
  });
  it("respects the minimum interval even after re-arming by flicker", () => {
    const g = new AutoSnapGate({ minIntervalMs: 1500, framesToRearm: 1 });
    expect(g.update({ aligned: true, stable: true, now: 0 })).toBe(true);
    g.update({ aligned: false, stable: false, now: 100 });
    expect(g.update({ aligned: true, stable: true, now: 200 })).toBe(false);
    expect(g.update({ aligned: true, stable: true, now: 1600 })).toBe(true);
  });
});
