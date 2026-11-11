import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { computeClassStanding, generateScorecardsPdf, type ScorecardInput } from "@/lib/export/scorecard-generator";
import { rescoreBatch } from "@/lib/grading/scorer";
import { simulateClass, syntheticKey } from "@/lib/grading/simulate";

describe("computeClassStanding", () => {
  it("uses competition ranking and mid-rank percentiles", () => {
    const s = computeClassStanding([
      { sheetId: "a", totalScore: 90 }, { sheetId: "b", totalScore: 80 }, { sheetId: "c", totalScore: 80 }, { sheetId: "d", totalScore: 50 },
    ]);
    expect(Object.fromEntries([...s].map(([k, v]) => [k, [v.rank, v.percentile]]))).toEqual({
      a: [1, 87.5], b: [2, 50], c: [2, 50], d: [4, 12.5],
    });
  });
});

describe("generateScorecardsPdf", () => {
  const key = syntheticKey(200, { seed: 2 });   // worst case: 200-question response grid
  const { scans } = simulateClass(key, { students: 12, seed: 3 });
  const sheets = rescoreBatch(scans, key);
  const standing = computeClassStanding(sheets);
  const cards: ScorecardInput[] = sheets.map((s, i) => ({
    institute: "St. Example High School", examTitle: "Quarterly Exam · Grade 10", date: "2026-11-10",
    student: { name: i === 0 ? "Ana María Cruz-Reyes" : `Student ${i}`, rollNumber: s.rollNumber, section: "10-A" },
    sheet: s, rank: standing.get(s.sheetId)!.rank, classSize: sheets.length, percentile: standing.get(s.sheetId)!.percentile,
  }));

  it("writes one A4 page per student, deterministically", async () => {
    const bytes = await generateScorecardsPdf(cards, { title: "Quarterly" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(12);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    const again = await generateScorecardsPdf(cards, { title: "Quarterly" });
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });

  it("embeds verification crops", async () => {
    // 1×1 white PNG
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAG2v8UQAAAABJRU5ErkJggg==", "base64"));
    const one = await generateScorecardsPdf([{ ...cards[0], crops: { roll: { bytes: png, type: "png" }, signature: { bytes: png, type: "png" } } }]);
    const plain = await generateScorecardsPdf([cards[0]]);
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1);
    expect(one.length).toBeGreaterThan(plain.length);
  });
});
