import { describe, expect, it } from "vitest";
import type { Roster } from "@/lib/roster/schema";
import { buildScanRosterChecklist } from "@/lib/scan-roster";

const roster: Roster = {
  schema: "omr-roster/v1",
  name: "CS 101",
  importedAt: 1000,
  students: [
    { rollNumber: "2026001", name: "Alice Santos", section: "A" },
    { rollNumber: "2026002", name: "Ben Cruz", section: "A" },
    { rollNumber: "2026003", name: "Cara Reyes", section: "A" },
  ],
};

describe("buildScanRosterChecklist", () => {
  it("returns null when no roster is loaded", () => {
    expect(buildScanRosterChecklist(null, [], [])).toBeNull();
  });

  it("tracks scanned count, missing students, duplicates, and unregistered rolls", () => {
    const view = buildScanRosterChecklist(
      roster,
      [{ sheetId: "db-1", rollNumber: "2026001" }],
      [
        { sheetId: "job-1", rollNumber: "2026001", calibration: false },
        { sheetId: "job-2", rollNumber: "9999999", calibration: false },
        { sheetId: "job-3", rollNumber: null, calibration: false },
        // calibration scans must be ignored
        { sheetId: "job-cal", rollNumber: "2026002", calibration: true },
      ],
    );

    expect(view).not.toBeNull();
    expect(view!.total).toBe(3);
    expect(view!.scanned).toBe(1);
    expect(view!.missing.map((s) => s.rollNumber)).toEqual(["2026002", "2026003"]);
    expect(view!.duplicates).toEqual([{ rollNumber: "2026001", name: "Alice Santos", count: 2 }]);
    expect(view!.unregistered).toEqual([{ rollNumber: "9999999", count: 1 }]);
    expect(view!.unreadableCount).toBe(1);
    expect(view!.classifyRoll("2026001")).toBe("duplicate");
    expect(view!.classifyRoll("9999999")).toBe("unregistered");
    expect(view!.classifyRoll("2026002")).toBe("missing");
    expect(view!.classifyRoll(null)).toBe("unreadable");
  });
});
