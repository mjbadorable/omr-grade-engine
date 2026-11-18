/**
 * Shared syllabus-parsing pieces: positioned PDF text items, the USA CLASE grading standard and
 * term detection. Kept in one small module so the line parser and the table-layout parser can both
 * use them without importing each other.
 */
import type { GradingPolicy } from "./types";

/** One text run from a PDF page, in PDF user space (origin bottom-left, y grows upward). */
export interface PdfItem { str: string; x: number; y: number; w: number; size: number }
export interface PdfPageItems { width: number; height: number; items: PdfItem[] }

/** USA CLASE grading standard, used when the syllabus does not state its own weights. */
export const CLASE_POLICY: GradingPolicy = {
  lectureWeight: 67,
  labWeight: 33,
  components: [
    { name: "Major Exam", weight: 50, group: "lecture" },
    { name: "Class Standing", weight: 50, group: "lecture" },
    { name: "Laboratory Exam", weight: 30, group: "lab" },
    { name: "Laboratory Activities", weight: 70, group: "lab" },
  ],
  source: "default",
};

export const GRADING_DEFAULT_WARNING = "Grading weights not found; the USA CLASE standard (67% lecture / 33% lab) was assumed.";

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\|\s*$/, "").trim();

/** "1st Semester, A.Y. 2025-2026" / "1st Sem AY 2025-2026" / "A.Y. 2025-2026, 2nd Semester" → the matched phrase, or "". */
export function findTerm(text: string): string {
  const m = text.match(/((?:1st|2nd|3rd|first|second|summer)\s+(?:semester|sem\.?|term)[\s,]*(?:(?:A\.?Y\.?|S\.?Y\.?|academic year)\s*)?\d{4}\s*[-–/]\s*\d{2,4})/i)
    ?? text.match(/((?:A\.?Y\.?|S\.?Y\.?)\s*\d{4}\s*[-–/]\s*\d{2,4}\s*[,\-–]?\s*(?:1st|2nd|first|second)\s+(?:semester|sem\.?|term))/i);
  return m ? tidy(m[1]) : "";
}
