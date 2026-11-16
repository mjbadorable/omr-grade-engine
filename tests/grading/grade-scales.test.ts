import { describe, expect, it } from "vitest";
import { DEFAULT_GRADE_BANDS } from "@/lib/grading/answer-key";
import { gradeFor } from "@/lib/grading/scorer";
import {
  bandsForPreset, bandsFromRows, cutoffRows, describeScale, detectScale, PH_ROWS, SCALE_PRESETS, validateRows,
} from "@/lib/grading/grade-scales";

/** The college table, in whole percentages (a student's percentage is rounded to the nearest whole number first). */
const PH: [number, string][] = [[97, "1.00"], [94, "1.25"], [91, "1.50"], [88, "1.75"], [84, "2.00"], [80, "2.25"], [78, "2.50"], [76, "2.75"], [75, "3.00"], [0, "5.00"]];
const oracle = (pct: number) => PH.find(([from]) => Math.round(pct) >= from)![1];

describe("Philippine 1.0 to 5.0 preset", () => {
  const bands = bandsForPreset("ph");
  it("uses the stepped college cutoffs", () => {
    expect(PH_ROWS).toEqual(PH.map(([from, label]) => ({ label, from })));
  });
  it("maps every boundary after rounding the percentage to the nearest whole number", () => {
    const cases: [number, string][] = [
      [100, "1.00"], [97, "1.00"], [96.5, "1.00"], [96.4, "1.25"], [94, "1.25"], [93.5, "1.25"], [93.4, "1.50"], [91, "1.50"], [90.5, "1.50"],
      [90.4, "1.75"], [88, "1.75"], [87.5, "1.75"], [87.4, "2.00"], [84, "2.00"], [83.5, "2.00"], [83.4, "2.25"], [80, "2.25"], [79.5, "2.25"],
      [79.4, "2.50"], [78, "2.50"], [77.5, "2.50"], [77.4, "2.75"], [76, "2.75"], [75.5, "2.75"], [75.4, "3.00"], [75, "3.00"], [74.5, "3.00"],
      [74.4, "5.00"], [60, "5.00"], [0, "5.00"],
    ];
    for (const [pct, grade] of cases) expect(gradeFor(pct, bands), `${pct}%`).toBe(grade);
  });
  it("agrees with round-then-look-up for every percentage from 0 to 100 in steps of 0.05", () => {
    for (let i = 0; i <= 2000; i++) { const p = i / 20; expect(gradeFor(p, bands), `${p}%`).toBe(oracle(p)); }
  });
  it("keeps the stored shape: plain { minPercent, label } bands", () => {
    for (const b of bands) expect(Object.keys(b).sort()).toEqual(["label", "minPercent"]);
  });
  it("has a lowest band at 0 so every student gets a grade", () => {
    expect(Math.min(...bands.map((b) => b.minPercent))).toBe(0);
  });
});

describe("other presets", () => {
  it("Letter A to F is exactly the existing default, so current exams do not change", () => {
    expect(bandsForPreset("letter")).toEqual(DEFAULT_GRADE_BANDS);
  });
  it("Percent is a plain pass / fail cutoff on the percentage", () => {
    const b = bandsForPreset("percent");
    expect(gradeFor(60, b)).toBe("Passed");
    expect(gradeFor(59.9, b)).toBe("Failed");
  });
  it("Letter and Percent do not round unless asked", () => {
    expect(gradeFor(89.6, bandsForPreset("letter"))).toBe("B");
  });
  it("lists the three presets by name", () => {
    expect(SCALE_PRESETS.map((p) => p.id)).toEqual(["letter", "percent", "ph"]);
  });
});

describe("detectScale / describeScale (the visible 'currently using' label)", () => {
  it("recognises each preset", () => {
    expect(detectScale(bandsForPreset("letter"))).toEqual({ id: "letter", rounded: false });
    expect(detectScale(bandsForPreset("percent"))).toEqual({ id: "percent", rounded: false });
    expect(detectScale(bandsForPreset("ph"))).toEqual({ id: "ph", rounded: true });
  });
  it("recognises a preset with rounding switched on or off", () => {
    expect(detectScale(bandsForPreset("letter", { rounded: true }))).toEqual({ id: "letter", rounded: true });
    expect(detectScale(bandsForPreset("ph", { rounded: false }))).toEqual({ id: "ph", rounded: false });
  });
  it("calls anything else custom", () => {
    expect(detectScale([{ minPercent: 0, label: "F" }, { minPercent: 50, label: "P" }]).id).toBe("custom");
  });
  it("words the label for a teacher", () => {
    expect(describeScale(bandsForPreset("ph"))).toMatch(/1\.0.*5\.0/);
    expect(describeScale(bandsForPreset("ph"))).toMatch(/whole/i);
    expect(describeScale(bandsForPreset("letter"))).toMatch(/Letter/);
    expect(describeScale([{ minPercent: 0, label: "F" }, { minPercent: 50, label: "P" }])).toMatch(/Custom/);
  });
});

describe("cutoff table <-> stored bands", () => {
  it("shows whole-percent cutoffs, highest first, whatever the rounding", () => {
    expect(cutoffRows(bandsForPreset("ph")).map((r) => [r.label, r.from])).toEqual(PH.map(([f, l]) => [l, f]));
    expect(cutoffRows(bandsForPreset("letter")).map((r) => r.from)).toEqual([90, 80, 70, 60, 0]);
  });
  it("round-trips through bandsFromRows without changing a band", () => {
    for (const id of ["letter", "percent", "ph"] as const) {
      for (const rounded of [false, true]) {
        const b = bandsForPreset(id, { rounded });
        expect(bandsFromRows(cutoffRows(b), rounded)).toEqual(b);
      }
    }
  });
  it("an edited cutoff keeps its rounding behaviour", () => {
    const rows = cutoffRows(bandsForPreset("ph")).map((r) => (r.label === "3.00" ? { ...r, from: 70 } : r));
    const b = bandsFromRows(rows, true);
    expect(gradeFor(69.5, b)).toBe("3.00");
    expect(gradeFor(69.4, b)).toBe("5.00");
  });
});

describe("validateRows", () => {
  const ok = [{ label: "A", from: 90 }, { label: "F", from: 0 }];
  it("accepts a sensible table", () => expect(validateRows(ok)).toBeNull());
  it("needs a row starting at 0%", () => expect(validateRows([{ label: "A", from: 90 }])).toMatch(/0%/));
  it("rejects empty or over-long labels", () => {
    expect(validateRows([{ label: " ", from: 50 }, { label: "F", from: 0 }])).toMatch(/name/i);
    expect(validateRows([{ label: "x".repeat(21), from: 50 }, { label: "F", from: 0 }])).toMatch(/name/i);
  });
  it("rejects cutoffs outside 0 to 100, non-numbers, and repeated cutoffs", () => {
    expect(validateRows([{ label: "A", from: 101 }, { label: "F", from: 0 }])).toMatch(/0.*100/);
    expect(validateRows([{ label: "A", from: Number.NaN }, { label: "F", from: 0 }])).toMatch(/0.*100/);
    expect(validateRows([{ label: "A", from: 50 }, { label: "B", from: 50 }, { label: "F", from: 0 }])).toMatch(/twice|same/i);
  });
  it("caps the table at 30 rows", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ label: `G${i}`, from: i }));
    expect(validateRows(many)).toMatch(/30/);
  });
});
