import { describe, expect, it } from "vitest";
import type { Roster } from "@/lib/roster/schema";
import { findStudent, rollChangePatch, studentChoices } from "@/lib/scan-actions";

const roster: Roster = {
  schema: "omr-roster/v1", name: "CS 101", importedAt: 1,
  students: [
    { rollNumber: "2026001", name: "Alice Santos" },
    { rollNumber: "2026002", name: "Ben Cruz" },
    { rollNumber: "2026003", name: "Cara Reyes" },
    { rollNumber: "2026010", name: "Dan Santos" },
  ],
};

describe("findStudent", () => {
  it("matches a scanned roll to the roster through the roll key (leading zeros, spacing)", () => {
    expect(findStudent(roster, "2026001")?.name).toBe("Alice Santos");
    expect(findStudent(roster, " 2026-002 ")?.name).toBe("Ben Cruz");
  });
  it("returns null with no roster, no roll, or an unknown roll", () => {
    expect(findStudent(null, "2026001")).toBeNull();
    expect(findStudent(roster, null)).toBeNull();
    expect(findStudent(roster, "999")).toBeNull();
  });
});

describe("studentChoices (the Change Student picker)", () => {
  it("lists the first few students when the search is empty", () => {
    expect(studentChoices(roster, "", 2).map((s) => s.rollNumber)).toEqual(["2026001", "2026002"]);
  });
  it("matches by name or roll, case-insensitively", () => {
    expect(studentChoices(roster, "santos").map((s) => s.name)).toEqual(["Alice Santos", "Dan Santos"]);
    expect(studentChoices(roster, "2026003").map((s) => s.name)).toEqual(["Cara Reyes"]);
  });
  it("puts an exact roll match first", () => {
    expect(studentChoices(roster, "2026010")[0].name).toBe("Dan Santos");
  });
  it("is empty without a roster", () => {
    expect(studentChoices(null, "a")).toEqual([]);
  });
});

describe("rollChangePatch", () => {
  it("is an audit-logged roll override that keeps what the scanner read", () => {
    const p = rollChangePatch({ sheetId: "s1", scannedRoll: "2026009", newRoll: "2026001", teacherId: "t" });
    expect(p).toMatchObject({ sheetId: "s1", target: "roll", questionNumber: 0, originalState: { value: "2026009" }, overriddenOption: "2026001", teacherId: "t" });
    expect(p.reason).toMatch(/scan/i);
    expect(p.id).toBeTruthy();
  });
  it("records an unreadable roll as null", () => {
    expect(rollChangePatch({ sheetId: "s1", scannedRoll: null, newRoll: "1", teacherId: "t" }).originalState.value).toBeNull();
  });
});
