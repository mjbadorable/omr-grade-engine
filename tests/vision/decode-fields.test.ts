import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/omr/layout-engine";
import { PRESETS } from "@/lib/omr/presets";
import { decodeFields } from "@/lib/vision/decode-fields";
import { bubbleRefs } from "@/lib/vision/read-bubbles";
import type { BubbleReadout, BubbleState } from "@/lib/vision/types";

const t = computeLayout({ templateId: "tpl-dec", ...PRESETS[2].settings }).template; // roll 10, set A-D, MCQ, numeric, matrix
const page = t.pages[0];

/** Build readouts straight from the template: every bubble EMPTY unless overridden. */
function readouts(states: Record<string, BubbleState>): BubbleReadout[] {
  return bubbleRefs(page).map((r) => ({
    questionIndex: r.questionIndex, optionIndex: r.optionIndex, bubbleId: r.id, field: r.field,
    state: states[r.id] ?? "EMPTY", density: 0, coverage: 0, adjustedDensity: 0, confidence: 1, center: { x: 0, y: 0 },
  }));
}
const roll = (digits: string): Record<string, BubbleState> => Object.fromEntries([...digits].map((d, i) => [`p0:roll:d${i}:${d}`, "FILLED"]));

describe("roll number & exam set", () => {
  it("decodes a clean roll number and set", () => {
    const f = decodeFields(page, readouts({ ...roll("2024123456"), "p0:set:C": "FILLED" }));
    expect(f.rollNumber).toBe("2024123456");
    expect(f.examSet).toBe("C");
    expect(f.conflicts).toEqual([]);
  });

  it("flags blank, multiple and uncertain columns with explicit payloads", () => {
    const s = roll("2024123456");
    delete s["p0:roll:d4:1"];                      // blank column 4
    s["p0:roll:d2:7"] = "FILLED";                  // column 2 has 2 and 7
    s["p0:roll:d6:9"] = "PARTIAL";                 // column 6 has a partial next to 3
    const f = decodeFields(page, readouts({ ...s, "p0:set:A": "FILLED", "p0:set:B": "FILLED" }));
    expect(f.rollNumber).toBeNull();
    expect(f.rollDigits).toEqual(["2", "0", null, "4", null, "2", null, "4", "5", "6"]);
    const codes = f.conflicts.map((c) => `${c.code}@${c.index}`);
    expect(codes).toEqual(expect.arrayContaining(["ROLL_DIGIT_MULTIPLE@2", "ROLL_DIGIT_BLANK@4", "ROLL_DIGIT_UNCERTAIN@6", "SET_MULTIPLE@0"]));
    expect(f.conflicts.find((c) => c.code === "ROLL_DIGIT_MULTIPLE")!.bubbleIds.sort()).toEqual(["p0:roll:d2:2", "p0:roll:d2:7"]);
    expect(f.examSet).toBeNull();
  });

  it("accepts an erasure next to a single fill, but not erasure residue alone", () => {
    const s = { ...roll("2024123456"), "p0:roll:d0:8": "ERASURE" as const, "p0:set:D": "ERASURE" as const };
    const f = decodeFields(page, readouts(s));
    expect(f.rollNumber).toBe("2024123456");
    expect(f.conflicts.map((c) => c.code)).toEqual(["SET_UNCERTAIN"]);
  });
});

describe("answers, numeric and matrix", () => {
  it("decodes answers and flags multiple/partial marks", () => {
    const f = decodeFields(page, readouts({
      ...roll("1111111111"), "p0:set:A": "FILLED",
      "p0:q1:B": "FILLED", "p0:q2:A": "FILLED", "p0:q2:D": "FILLED", "p0:q3:C": "PARTIAL", "p0:q4:A": "ERASURE", "p0:q4:C": "FILLED",
    }));
    const a = Object.fromEntries(f.answers.map((x) => [x.questionNumber, x]));
    expect(a[1].labels).toEqual(["B"]);
    expect(a[2].labels).toEqual(["A", "D"]);
    expect(a[3]).toMatchObject({ marked: [], uncertain: true });
    expect(a[4].labels).toEqual(["C"]);
    expect(a[5].marked).toEqual([]);
    expect(f.conflicts.map((c) => `${c.code}@${c.index}`)).toEqual(["ANSWER_MULTIPLE@2", "ANSWER_UNCERTAIN@3"]);
  });

  it("decodes signed decimals, skips blank columns and rejects malformed numbers", () => {
    const f = decodeFields(page, readouts({
      // Q31: "-12.5" → sign, col0=1, col1=2, col2='.', col3=5
      "p0:q31:sign": "FILLED", "p0:q31:d0:1": "FILLED", "p0:q31:d1:2": "FILLED", "p0:q31:dot:d2": "FILLED", "p0:q31:d3:5": "FILLED",
      // Q32: digit and dot in the same column → invalid
      "p0:q32:d0:3": "FILLED", "p0:q32:dot:d0": "FILLED",
    }));
    expect(f.numeric).toEqual([
      { questionNumber: 31, value: "-12.5", uncertain: false },
      { questionNumber: 32, value: null, uncertain: false },
    ]);
    expect(f.conflicts.some((c) => c.code === "NUMERIC_INVALID" && c.index === 32)).toBe(true);
  });

  it("decodes matrix rows", () => {
    const f = decodeFields(page, readouts({ "p0:q33:AP": "FILLED", "p0:q33:AQ": "FILLED", "p0:q33:CT": "FILLED" }));
    expect(f.matrix[0].rows).toEqual({ A: ["P", "Q"], B: [], C: ["T"], D: [] });
  });
});
