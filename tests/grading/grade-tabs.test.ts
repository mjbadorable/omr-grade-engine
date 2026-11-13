import { describe, expect, it } from "vitest";
import { exceptionsCount, gradeTabs } from "@/lib/grading/grade-tabs";

const base = { keyed: 18, total: 20, sheets: 42, exceptions: 0, belowTarget: 0 };

describe("exceptionsCount", () => {
  it("adds open conflicts to the roster problems when a roster is imported", () => {
    expect(exceptionsCount({ openConflicts: 1, hasRoster: true, absent: 3, unregistered: 2, unreadable: 1 })).toBe(7);
  });

  it("without a roster only conflicts and unreadable rolls count (every sheet would look unregistered)", () => {
    expect(exceptionsCount({ openConflicts: 2, hasRoster: false, absent: 0, unregistered: 40, unreadable: 3 })).toBe(5);
  });

  it("is zero when nothing needs attention", () => {
    expect(exceptionsCount({ openConflicts: 0, hasRoster: true, absent: 0, unregistered: 0, unreadable: 0 })).toBe(0);
  });
});

describe("gradeTabs", () => {
  it("lists the five sub-tabs in order, keeping the existing tab ids", () => {
    expect(gradeTabs(base).map((t) => [t.id, t.label])).toEqual([
      ["gradebook", "Results"], ["key", "Answer Key"], ["roster", "Review Exceptions"], ["analysis", "Item Analysis"], ["outcomes", "OBE Outcomes"],
    ]);
  });

  it("shows the sheet count on Results and keyed / total on Answer Key", () => {
    const t = gradeTabs(base);
    expect(t.find((x) => x.id === "gradebook")?.count).toBe("42");
    expect(t.find((x) => x.id === "key")?.count).toBe("18 / 20");
  });

  it("flags Review Exceptions only when there are exceptions", () => {
    expect(gradeTabs(base).find((x) => x.id === "roster")).toMatchObject({ count: null, warn: false });
    expect(gradeTabs({ ...base, exceptions: 4 }).find((x) => x.id === "roster")).toMatchObject({ count: "4", warn: true });
  });

  it("flags OBE Outcomes only when outcomes are below target", () => {
    expect(gradeTabs(base).find((x) => x.id === "outcomes")).toMatchObject({ count: null, warn: false });
    expect(gradeTabs({ ...base, belowTarget: 2 }).find((x) => x.id === "outcomes")).toMatchObject({ count: "2 below target", warn: true });
  });

  it("has no count on Item Analysis", () => {
    expect(gradeTabs(base).find((x) => x.id === "analysis")?.count).toBeNull();
  });

  it("marks the answer key as needing attention while questions are unkeyed", () => {
    expect(gradeTabs(base).find((x) => x.id === "key")?.warn).toBe(true);
    expect(gradeTabs({ ...base, keyed: 20 }).find((x) => x.id === "key")?.warn).toBe(false);
  });
});
