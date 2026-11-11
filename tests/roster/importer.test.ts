import { describe, expect, it } from "vitest";
import { detectColumns, importRoster, parseCsv, rosterToCsv } from "@/lib/roster/importer";
import { rollKey } from "@/lib/roster/schema";

describe("rollKey", () => {
  it.each([
    ["00123", "123"], [" 123 ", "123"], ["0-0123", "123"], ["123.0".slice(0, 3), "123"],
    ["S-0123", "S0123"], ["s 0123", "S0123"], ["0000", "0"], ["", null], [null, null],
  ])("%s → %s", (raw, key) => expect(rollKey(raw as string | null)).toBe(key));
});

describe("parseCsv", () => {
  it("handles BOM, quotes, embedded commas/quotes/newlines and CRLF", () => {
    const rows = parseCsv('﻿Roll,Name\r\n1,"Cruz, Ana"\r\n2,"He said ""hi"""\n3,"multi\nline"\n\n');
    expect(rows).toEqual([["Roll", "Name"], ["1", "Cruz, Ana"], ["2", 'He said "hi"'], ["3", "multi\nline"]]);
  });

  it("sniffs semicolon and tab delimiters", () => {
    expect(parseCsv("LRN;Full Name\n1;Ana")).toEqual([["LRN", "Full Name"], ["1", "Ana"]]);
    expect(parseCsv("LRN\tFull Name\n1\tAna")).toEqual([["LRN", "Full Name"], ["1", "Ana"]]);
  });
});

describe("detectColumns", () => {
  it.each([
    [["Student ID", "Full Name", "Section"], { rollNumber: 0, name: 1, section: 2 }],
    [["LRN", "Learner Name", "Grade & Section", "Guardian Contact", "Mobile No."], { rollNumber: 0, name: 1, section: 2, guardianContact: 3, phone: 4 }],
    [["Roll No.", "First Name", "Last Name", "E-mail"], { rollNumber: 0, firstName: 1, lastName: 2, email: 3 }],
    [["Admission Number", "Name of Student", "Class"], { rollNumber: 0, name: 1, section: 2 }],
  ])("%j", (headers, expected) => expect(detectColumns(headers)).toEqual(expected));
});

describe("importRoster", () => {
  it("sanitises whitespace, joins first/last names, validates email and drops duplicate rolls", () => {
    const csv = [
      "Roll No.,First Name,Last Name,Section,E-mail,Parent Phone",
      " 0012 ,  Ana  , Cruz ,10-A, ANA@school.edu ,0917 000 1111",
      "12,Ben,Reyes,10-A,ben@,",
      "0013,Carla,,10-B,,",
      ",Dan,Lim,10-B,,",
    ].join("\n");
    const r = importRoster(csv, { now: 1 });
    expect(r.roster.students).toEqual([
      { rollNumber: "0012", name: "Ana Cruz", section: "10-A", email: "ana@school.edu", guardianContact: "0917 000 1111" },
      { rollNumber: "0013", name: "Carla", section: "10-B" },
    ]);
    expect(r.duplicates).toEqual([{ row: 3, rollNumber: "12", firstRow: 2 }]);
    expect(r.issues.map((i) => `${i.code}@${i.row}`)).toEqual(["DUPLICATE_ROLL@3", "MISSING_ROLL@5"]);
  });

  it("reports missing columns and honours a manual mapping", () => {
    const bad = importRoster("Foo,Bar\n1,2");
    expect(bad.issues.map((i) => i.code)).toEqual(["NO_ROLL_COLUMN", "NO_NAME_COLUMN"]);
    const fixed = importRoster("Foo,Bar\n7,Zed", { mapping: { rollNumber: 0, name: 1 } });
    expect(fixed.roster.students).toEqual([{ rollNumber: "7", name: "Zed" }]);
  });

  it("round-trips through rosterToCsv", () => {
    const r = importRoster("Roll,Name,Section\n1,\"Cruz, Ana\",A\n2,Ben,B").roster;
    expect(importRoster(rosterToCsv(r)).roster.students).toEqual(r.students);
  });
});
