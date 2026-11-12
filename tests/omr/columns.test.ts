import { describe, expect, it } from "vitest";
import { clampOptions, columnBlockedReason, maxColumnsForOptions, normalizeSettings, safeColumnLimit } from "@/lib/omr/columns";
import { computeLayout, validateTemplate } from "@/lib/omr/layout-engine";
import { DEFAULT_SETTINGS } from "@/lib/omr/presets";
import { LayoutSettingsSchema, type LayoutSettings } from "@/lib/omr/schema";

const sheet = (questions: number, optionCount: number, columns: number, extra: Partial<LayoutSettings> = {}): LayoutSettings => ({
  ...DEFAULT_SETTINGS, templateId: "tpl-cols", columns, ...extra,
  sections: [{ id: "s1", name: "", type: "mcq", questionCount: questions, optionCount, optionStyle: "letters" }],
});
const errors = (r: ReturnType<typeof computeLayout>) => r.issues.filter((i) => i.severity === "error");

describe("option range 2..6", () => {
  it("clamps to 2–6 and the schema refuses anything else", () => {
    expect([0, 1, 2, 6, 7, 10, 99, NaN].map(clampOptions)).toEqual([2, 2, 2, 6, 6, 6, 6, 4]);
    expect(LayoutSettingsSchema.safeParse(sheet(20, 6, 2)).success).toBe(true);
    expect(LayoutSettingsSchema.safeParse(sheet(20, 7, 2)).success).toBe(false);
    expect(LayoutSettingsSchema.safeParse(sheet(20, 10, 2)).success).toBe(false);
  });
  it("normalizeSettings and the layout compiler never produce A–J", () => {
    const n = normalizeSettings(sheet(20, 10, 2) as LayoutSettings);
    expect(n.sections[0]).toMatchObject({ optionCount: 6 });
    const r = computeLayout(sheet(20, 10, 2));                       // would have thrown a schema error before
    const q = r.template.pages[0].regions.flatMap((x) => (x.kind === "mcq" ? x.questions : []))[0];
    expect(q.options).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
  it("true/false sections stay at 2 choices", () => {
    const s = { ...sheet(10, 2, 3), sections: [{ id: "s1", name: "", type: "mcq" as const, questionCount: 10, optionCount: 9, optionStyle: "true-false" as const }] };
    expect(normalizeSettings(s).sections[0]).toMatchObject({ optionCount: 2 });
  });
});

describe("safe column caps (A4)", () => {
  it("2–4 choices → 4 columns, 5 → 3, 6 → 2", () => {
    expect([2, 3, 4, 5, 6].map((n) => maxColumnsForOptions(n))).toEqual([4, 4, 4, 3, 2]);
    expect(safeColumnLimit(sheet(20, 5, 1))).toBe(3);
    expect(safeColumnLimit({ sections: [...sheet(20, 4, 1).sections, { id: "b", name: "", type: "mcq", questionCount: 5, optionCount: 6, optionStyle: "letters" }] })).toBe(2);   // tightest section wins
  });
  it("compact bubbles (≤ 3.8 mm) allow one more column, so the 200-question preset keeps its 5 columns", () => {
    expect(safeColumnLimit({ ...sheet(200, 4, 5, { bubbleDiameterMm: 3.6 }) })).toBe(5);
    expect(errors(computeLayout(sheet(200, 4, 5, { bubbleDiameterMm: 3.6 })))).toEqual([]);
  });
  it("selecting 5 or 6 choices steps the columns down automatically", () => {
    expect(normalizeSettings(sheet(60, 5, 4)).columns).toBe(3);
    expect(normalizeSettings(sheet(60, 6, 4)).columns).toBe(2);
    expect(normalizeSettings(sheet(60, 4, 4)).columns).toBe(4);       // unchanged
    const same = sheet(60, 4, 4);
    expect(normalizeSettings(same)).toBe(same);                       // same object when nothing changes
  });
  it("unsafe column counts are reported for the disabled menu entries", () => {
    const s = sheet(60, 6, 2);
    expect([1, 2, 3, 4].map((n) => columnBlockedReason(s, n))).toEqual([null, null, "too wide for 6 choices (A–F)", "too wide for 6 choices (A–F)"]);
  });
});

describe("60 questions with 6 choices (A–F)", () => {
  it("auto-caps 4 columns to 2, compiles with no errors and no horizontal overlap between columns", () => {
    const r = computeLayout(sheet(60, 6, 4));
    expect(errors(r)).toEqual([]);
    expect(r.issues.find((i) => i.code === "COLUMNS_REDUCED")).toMatchObject({ severity: "warning" });
    expect(validateTemplate(r.template).filter((i) => i.code === "COLUMN_OVERLAP" || i.code === "OVERLAP")).toEqual([]);
    // geometric proof: regions that share rows are separated horizontally by a real gap
    for (const page of r.template.pages) {
      const regions = page.regions.filter((x) => x.kind === "mcq");
      for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) {
        const A = regions[a].bbox, B = regions[b].bbox;
        if (A.y < B.y + B.h && B.y < A.y + A.h) expect(Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w))).toBeGreaterThanOrEqual(1.5);
      }
    }
    expect(r.stats.questions).toBe(60);
  });
  it("also fits 60 questions of 5 choices at 3 columns and 60 of 4 choices at 4 columns without errors", () => {
    expect(errors(computeLayout(sheet(60, 5, 3)))).toEqual([]);
    expect(errors(computeLayout(sheet(60, 4, 4)))).toEqual([]);
  });
});

describe("column collision validator", () => {
  it("flags adjacent columns that touch or overlap", () => {
    const r = computeLayout(sheet(60, 4, 4));
    const t = structuredClone(r.template);
    const mcq = t.pages[0].regions.filter((x) => x.kind === "mcq");
    const right = mcq.find((m) => m.bbox.x > mcq[0].bbox.x + 10)!;
    right.bbox = { ...right.bbox, x: mcq[0].bbox.x + mcq[0].bbox.w - 2 };      // pushed 2 mm into column 1
    const issues = validateTemplate(t);
    expect(issues.some((i) => i.code === "COLUMN_OVERLAP" && i.severity === "error")).toBe(true);
  });
  it("does not flag a normal sheet", () => {
    expect(validateTemplate(computeLayout(sheet(100, 4, 4)).template).filter((i) => i.code === "COLUMN_OVERLAP")).toEqual([]);
  });
});
