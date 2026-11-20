import { describe, expect, it } from "vitest";
import { firstUncertainQuestion, flaggedQueue, isEditableInputTarget, queuePosition } from "@/lib/grading/review-queue";
import type { SummarySheet } from "@/lib/grading/grade-summary";

const sheet = (id: string, flaggedCount = 0, sheetFlags: SummarySheet["sheetFlags"] = []): SummarySheet => ({
  sheetId: id,
  rollNumber: id,
  percentage: 80,
  flaggedCount,
  sheetFlags,
});

describe("fast review queue helpers", () => {
  it("extracts only sheets that need review in sheet order", () => {
    const sheets = [
      sheet("s1", 0, []),
      sheet("s2", 2, []),
      sheet("s3", 0, ["UNREADABLE_ROLL"]),
      sheet("s4", 0, []),
      sheet("s5", 1, ["SYNC_CONFLICT"]),
    ];
    expect(flaggedQueue(sheets)).toEqual(["s2", "s3", "s5"]);
  });

  it("computes 1-based position and prev/next navigation targets", () => {
    const q = ["s2", "s3", "s5"];
    expect(queuePosition(q, "s2")).toEqual({ position: 1, total: 3, prevId: null, nextId: "s3" });
    expect(queuePosition(q, "s3")).toEqual({ position: 2, total: 3, prevId: "s2", nextId: "s5" });
    expect(queuePosition(q, "s5")).toEqual({ position: 3, total: 3, prevId: "s3", nextId: null });
    expect(queuePosition(q, "s1")).toEqual({ position: null, total: 3, prevId: null, nextId: "s2" });
  });

  it("finds the first FLAGGED_CONFLICT question for auto-jump", () => {
    expect(firstUncertainQuestion([
      { printedNumber: 1, status: "CORRECT" },
      { printedNumber: 4, status: "FLAGGED_CONFLICT" },
      { printedNumber: 9, status: "FLAGGED_CONFLICT" },
    ])).toBe(4);
    expect(firstUncertainQuestion([{ printedNumber: 1, status: "CORRECT" }])).toBeNull();
  });

  it("treats custom crystal Select comboboxes/listboxes as editable targets so modal shortcuts stay suppressed", () => {
    expect(isEditableInputTarget({ tagName: "BUTTON", getAttribute: (n: string) => (n === "role" ? "combobox" : null) } as unknown as EventTarget)).toBe(true);
    expect(isEditableInputTarget({ tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "option" : null) } as unknown as EventTarget)).toBe(true);
    expect(isEditableInputTarget({ tagName: "SPAN", closest: () => ({}) } as unknown as EventTarget)).toBe(true);
    expect(isEditableInputTarget({ tagName: "BUTTON", getAttribute: () => null } as unknown as EventTarget)).toBe(false);
  });
});
