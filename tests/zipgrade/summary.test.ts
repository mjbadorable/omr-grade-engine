import { describe, expect, it } from "vitest";
import { sheetSummary } from "@/lib/omr/summary";

describe("sheetSummary (educator-friendly status)", () => {
  it("valid single page", () => {
    expect(sheetSummary({ questions: 100, pages: 1, paper: "A4", layoutErrors: 0 })).toEqual({ tone: "ok", text: "✓ 100 Questions · 1 Page (A4) · Ready to Print" });
    expect(sheetSummary({ questions: 1, pages: 1, paper: "LETTER", layoutErrors: 0 }).text).toBe("✓ 1 Question · 1 Page (Letter) · Ready to Print");
  });
  it("multi-page says how to fit on one page", () => {
    expect(sheetSummary({ questions: 200, pages: 2, paper: "A4", layoutErrors: 0 })).toEqual({ tone: "warn", text: "2 Pages — Reduce questions or add columns to fit 1 page" });
  });
  it("layout errors win and never expose internals", () => {
    const s = sheetSummary({ questions: 100, pages: 1, paper: "A4", layoutErrors: 3 });
    expect(s.tone).toBe("error");
    expect(s.text).not.toMatch(/bubble|marks|#|hash/i);
  });
});

import { answerKeyStatus } from "@/lib/grading/status";
describe("answerKeyStatus", () => {
  it("plain-language status without timings, versions or hashes", () => {
    expect(answerKeyStatus({ keyed: 0, total: 100, papers: 0 })).toBe("Answer Key: 0 / 100 keyed · 0 Papers Scanned");
    expect(answerKeyStatus({ keyed: 100, total: 100, papers: 1 })).toBe("Answer Key: 100 / 100 keyed · 1 Paper Scanned");
    expect(answerKeyStatus({ keyed: 5, total: 20, papers: 3, saving: true })).toMatch(/saving…$/);
    expect(answerKeyStatus({ keyed: 5, total: 20, papers: 3 })).not.toMatch(/ms|v\d|#/);
  });
});
