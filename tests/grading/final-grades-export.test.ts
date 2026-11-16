import { describe, expect, it } from "vitest";
import { buildSampleExam } from "@/lib/samples/sample-kit";
import * as XLSX from "xlsx";
import { finalGradesRows, toCsv, toFinalGradesWorkbook } from "@/lib/grading/export";
import { bandsForPreset } from "@/lib/grading/grade-scales";
import { scoreSheet } from "@/lib/grading/scorer";
import type { Roster } from "@/lib/roster/schema";
import type { DecodedFields } from "@/lib/vision/types";

const { key } = buildSampleExam();
const fieldsFor = (roll: string | null, n: number): DecodedFields => ({
  rollNumber: roll, rollDigits: roll ? [...roll] : [], examSet: "A", numeric: [], matrix: [], conflicts: [],
  answers: [...key.questions.values()].slice(0, n).map((r) => ({ questionNumber: r.questionNumber, marked: r.type === "choice" ? [...r.correct] : [], labels: [], uncertain: false })),
});
const sheet = (id: string, roll: string | null, n: number, k = key) => ({ ...scoreSheet({ fields: fieldsFor(roll, n) }, k), sheetId: id });

const roster: Roster = { schema: "omr-roster/v1", name: "CS 101", importedAt: 1, students: [
  { rollNumber: "240101", name: "Tala Garcia" }, { rollNumber: "240102", name: "Noah, Kumar" },
] };
const phKey = { ...key, gradeBands: bandsForPreset("ph") };

describe("finalGradesRows (roll number, name, final grade)", () => {
  it("has exactly the three registrar columns", () => {
    expect(finalGradesRows([], roster).header).toEqual(["Roll Number", "Name", "Final Grade"]);
  });
  it("uses the transmuted grade stored on each sheet, with the student's name from the roster", () => {
    const full = sheet("s1", "240101", 20, phKey);
    const none = sheet("s2", "240102", 0, phKey);
    const { rows } = finalGradesRows([none, full], roster);
    expect(rows).toEqual([["240101", "Tala Garcia", "1.00"], ["240102", "Noah, Kumar", "5.00"]]);
  });
  it("matches rolls the way the roster does (leading zeros), and leaves the name blank when unknown", () => {
    const { rows } = finalGradesRows([sheet("a", "0240101", 20, phKey), sheet("b", "999", 20, phKey)], roster);
    expect(rows.find((r) => r[0] === "0240101")?.[1]).toBe("Tala Garcia");
    expect(rows.find((r) => r[0] === "999")?.[1]).toBe("");
  });
  it("lists an unreadable roll as blank rather than dropping the sheet", () => {
    const { rows } = finalGradesRows([sheet("a", null, 20, phKey)], roster);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("");
  });
  it("works without a roster (names blank)", () => {
    expect(finalGradesRows([sheet("a", "240101", 20, phKey)], null).rows[0].slice(0, 2)).toEqual(["240101", ""]);
  });
  it("sorts by roll number, numbers in numeric order", () => {
    const { rows } = finalGradesRows([sheet("a", "240110", 20), sheet("b", "240102", 20), sheet("c", "240101", 20)], null);
    expect(rows.map((r) => r[0])).toEqual(["240101", "240102", "240110"]);
  });
  it("writes a CSV that quotes commas in names", () => {
    const csv = toCsv(finalGradesRows([sheet("a", "240102", 20, phKey)], roster));
    expect(csv).toContain('240102,"Noah, Kumar",1.00');
  });
});

describe("toFinalGradesWorkbook", () => {
  const read = (buf: ArrayBuffer) => { const wb = XLSX.read(buf, { type: "array" }); return { names: wb.SheetNames, rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]) }; };
  it("writes one sheet with the three columns, numeric grades as numbers", () => {
    const t = finalGradesRows([sheet("a", "240101", 20, phKey), sheet("b", "240102", 0, phKey)], roster);
    const { names, rows } = read(toFinalGradesWorkbook(XLSX, t));
    expect(names).toEqual(["Final grades"]);
    expect(rows).toEqual([{ "Roll Number": "240101", Name: "Tala Garcia", "Final Grade": 1 }, { "Roll Number": "240102", Name: "Noah, Kumar", "Final Grade": 5 }]);
  });
  it("keeps letter grades as text", () => {
    const t = finalGradesRows([sheet("a", "240101", 20)], roster);
    expect(read(toFinalGradesWorkbook(XLSX, t)).rows[0]["Final Grade"]).toBe("A");
  });
});
