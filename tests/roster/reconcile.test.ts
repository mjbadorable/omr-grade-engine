import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/roster/reconcile";
import type { Roster } from "@/lib/roster/schema";

const roster: Roster = {
  schema: "omr-roster/v1", name: "10-A", importedAt: 0,
  students: [
    { rollNumber: "00101", name: "Ana" },
    { rollNumber: "102", name: "Ben" },
    { rollNumber: "01-03", name: "Carla" },
    { rollNumber: "104", name: "Dan" },
  ],
};

describe("reconcile", () => {
  const r = reconcile(roster, [
    { sheetId: "a", rollNumber: "0000101" },  // leading zeros from the bubble grid
    { sheetId: "b", rollNumber: "102" },
    { sheetId: "b2", rollNumber: "00102" },    // rescan of Ben
    { sheetId: "c", rollNumber: "0000103" },  // roster has "01-03"
    { sheetId: "x", rollNumber: "999" },       // not on roster
    { sheetId: "u", rollNumber: null },        // unreadable roll
  ]);

  it("matches across leading zeros and punctuation", () => {
    const matched = r.entries.filter((e) => e.status === "MATCHED");
    expect(matched.map((e) => e.status === "MATCHED" && [e.student.name, e.sheetIds])).toEqual([["Ana", ["a"]], ["Ben", ["b", "b2"]], ["Carla", ["c"]]]);
    expect(r.studentBySheet.get("b2")?.name).toBe("Ben");
  });

  it("reports absent, unregistered, unreadable and duplicate sheets", () => {
    expect(r.entries.find((e) => e.status === "ABSENT")).toMatchObject({ student: { name: "Dan" } });
    expect(r.entries.find((e) => e.status === "UNREGISTERED_STUDENT")).toMatchObject({ rollNumber: "999", sheetIds: ["x"] });
    expect(r.entries.find((e) => e.status === "UNREADABLE_ROLL")).toMatchObject({ sheetIds: ["u"] });
    expect(r.summary).toEqual({ roster: 4, matched: 3, unregistered: 1, absent: 1, unreadable: 1, duplicates: 1 });
  });

  it("works without a roster (everything is unregistered)", () => {
    const n = reconcile(null, [{ sheetId: "a", rollNumber: "1" }]);
    expect(n.summary).toMatchObject({ roster: 0, matched: 0, unregistered: 1 });
  });
});
