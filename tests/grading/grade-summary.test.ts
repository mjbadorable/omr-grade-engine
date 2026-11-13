import { describe, expect, it } from "vitest";
import { duplicateRolls, gradeSummary, sheetStatus, type SummarySheet } from "@/lib/grading/grade-summary";

const sheet = (id: string, roll: string | null, pct: number, over: Partial<SummarySheet> = {}): SummarySheet => ({ sheetId: id, rollNumber: roll, percentage: pct, flaggedCount: 0, sheetFlags: [], ...over });

describe("sheetStatus (priority: needs review > duplicate > graded)", () => {
  it("is graded for a clean sheet", () => {
    expect(sheetStatus(sheet("a", "1", 80), false)).toEqual({ status: "graded", label: "Graded" });
  });
  it("needs review when answers are flagged or the sheet has a problem", () => {
    expect(sheetStatus(sheet("a", "1", 80, { flaggedCount: 2 }), false).status).toBe("needs-review");
    expect(sheetStatus(sheet("a", "1", 80, { sheetFlags: ["SYNC_CONFLICT"] }), false)).toEqual({ status: "needs-review", label: "Needs Review" });
  });
  it("shows Duplicate for a clean sheet whose roll number appears more than once", () => {
    expect(sheetStatus(sheet("a", "1", 80), true)).toEqual({ status: "duplicate", label: "Duplicate" });
  });
  it("a flagged duplicate is Needs Review, not Duplicate", () => {
    expect(sheetStatus(sheet("a", "1", 80, { flaggedCount: 1 }), true).status).toBe("needs-review");
  });
});

describe("duplicateRolls", () => {
  it("returns roll numbers that occur on more than one sheet, ignoring unreadable ones", () => {
    const d = duplicateRolls([sheet("a", "1", 1), sheet("b", "1", 1), sheet("c", "2", 1), sheet("d", null, 1), sheet("e", null, 1)]);
    expect([...d]).toEqual(["1"]);
  });
});

describe("gradeSummary", () => {
  it("is all zero with a null average when there are no sheets", () => {
    expect(gradeSummary([])).toEqual({ students: 0, graded: 0, needsReview: 0, classAverage: null });
  });

  it("counts each sheet once: graded + needs review = sheets", () => {
    const s = gradeSummary([sheet("a", "1", 90), sheet("b", "2", 70, { flaggedCount: 3 }), sheet("c", "3", 50, { sheetFlags: ["SYNC_CONFLICT"] })]);
    expect(s).toMatchObject({ students: 3, graded: 1, needsReview: 2 });
  });

  it("does not double-count a sheet that is both flagged and in an open conflict", () => {
    const both = sheet("a", "1", 80, { flaggedCount: 2, sheetFlags: ["SYNC_CONFLICT", "ROLL_UNCERTAIN"] });
    expect(gradeSummary([both, sheet("b", "2", 60)])).toMatchObject({ graded: 1, needsReview: 1 });
  });

  it("counts a student once however many sheets they have, and every unreadable sheet separately", () => {
    const s = gradeSummary([sheet("a", "1", 80), sheet("b", "1", 80), sheet("c", null, 40), sheet("d", null, 40)]);
    expect(s.students).toBe(3);
  });

  it("treats duplicate-roll sheets without flags as graded", () => {
    expect(gradeSummary([sheet("a", "1", 80), sheet("b", "1", 70)])).toMatchObject({ graded: 2, needsReview: 0 });
  });

  it("averages every scored sheet and rounds to one decimal", () => {
    expect(gradeSummary([sheet("a", "1", 90), sheet("b", "2", 75, { flaggedCount: 1 }), sheet("c", "3", 60.55)]).classAverage).toBe(75.2);
  });
});
