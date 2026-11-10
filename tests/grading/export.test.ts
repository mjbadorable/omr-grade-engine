import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { gradebookRows, toCsv, toWorkbook } from "@/lib/grading/export";
import { analyzeItems } from "@/lib/grading/item-analysis";
import { rescoreBatch } from "@/lib/grading/scorer";
import { simulateClass, syntheticKey } from "@/lib/grading/simulate";

const key = syntheticKey(12, { seed: 4, sets: ["A", "B"], shuffle: true });
const { scans } = simulateClass(key, { students: 30, seed: 8 });
const sheets = rescoreBatch(scans, key);

describe("exports", () => {
  it("gradebook rows carry summary + per-question answer/status/points", () => {
    const { header, rows } = gradebookRows(sheets, key);
    expect(header.slice(0, 4)).toEqual(["Sheet ID", "Roll Number", "Set", "Score"]);
    expect(header).toContain("Q12 points");
    expect(header).toContain("Math score");
    expect(rows).toHaveLength(30);
    expect(rows[0][header.indexOf("Score")]).toBe(sheets[0].totalScore);
  });

  it("CSV escapes quotes/commas and neutralises formula injection", () => {
    const csv = toCsv({ header: ["a", "b", "c"], rows: [["=HYPERLINK(\"x\")", "x,y", -3]] });
    expect(csv).toBe('a,b,c\r\n"\'=HYPERLINK(""x"")","x,y",-3\r\n');
  });

  it("writes an .xlsx that SheetJS reads back with three sheets", () => {
    const buf = toWorkbook(XLSX, sheets, key, analyzeItems(sheets, key));
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    expect(wb.SheetNames).toEqual(["Gradebook", "Item analysis", "Summary"]);
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Gradebook, { header: 1 });
    expect(grid).toHaveLength(31);
    expect(grid[1][1]).toBe(sheets[0].rollNumber);
  });
});
