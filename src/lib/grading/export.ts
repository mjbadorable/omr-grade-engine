/**
 * Tabular exports (pure). `gradebookRows` feeds both CSV and the SheetJS workbook.
 */
import { findStudent } from "@/lib/scan-actions";
import type { Roster } from "@/lib/roster/schema";
import type { AnswerKey, PsychometricReport, ScoredSheet } from "./types";

type Cell = string | number | null;

export function gradebookRows(sheets: readonly ScoredSheet[], key: AnswerKey): { header: string[]; rows: Cell[][] } {
  const qs = [...key.questions.values()].filter((r) => !r.dropped).map((r) => r.questionNumber);
  const subjects = [...new Set([...key.questions.values()].map((r) => r.tags.subject).filter((x): x is string => !!x))].sort();
  const header = [
    "Sheet ID", "Roll Number", "Set", "Score", "Max", "Percent", "Grade", "Correct", "Incorrect", "Omitted", "Flagged", "Accuracy", "Sheet Flags",
    ...subjects.map((s) => `${s} score`),
    ...qs.flatMap((q) => [`Q${q} answer`, `Q${q} status`, `Q${q} points`]),
  ];
  const rows = sheets.map((s) => {
    const byQ = new Map(s.items.map((i) => [i.questionNumber, i]));
    return [
      s.sheetId, s.rollNumber, s.examSet, s.totalScore, s.maxScore, s.percentage, s.grade,
      s.correctCount, s.incorrectCount, s.omittedCount, s.flaggedCount, s.accuracy, s.sheetFlags.join(" "),
      ...subjects.map((sub) => s.bySubject[sub]?.score ?? null),
      ...qs.flatMap((q) => {
        const it = byQ.get(q);
        return it ? [it.answerText ?? it.selectedLabels.join(""), it.status, it.scoreEarned] : [null, null, null];
      }),
    ];
  });
  return { header, rows };
}

export function itemAnalysisRows(rep: PsychometricReport): { header: string[]; rows: Cell[][] } {
  const maxOpts = Math.max(0, ...rep.items.map((i) => i.distractors.length));
  const letters = "ABCDEFGHIJ".slice(0, maxOpts).split("");
  return {
    header: ["Question", "Type", "N", "p (difficulty)", "D (discrimination)", "p upper", "p lower", "r_pbis", "r_pbis corrected", "Omitted", "Quality", "Flags", ...letters.map((l) => `${l} %`)],
    rows: rep.items.map((i) => [
      i.questionNumber, i.type, i.n, i.p, i.d, i.pUpper, i.pLower, i.rpbis, i.rpbisCorrected, i.omitted, i.quality, i.flags.join(" "),
      ...letters.map((_, o) => (i.distractors[o] ? Math.round(i.distractors[o].proportion * 1000) / 10 : null)),
    ]),
  };
}

const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // neutralise spreadsheet formula injection, then quote if needed
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv({ header, rows }: { header: string[]; rows: Cell[][] }): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Build an .xlsx (Gradebook, Item analysis, Summary) with SheetJS; `XLSX` is injected so it can be lazy-loaded. */
export function toWorkbook(XLSX: typeof import("xlsx"), sheets: readonly ScoredSheet[], key: AnswerKey, rep: PsychometricReport): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const g = gradebookRows(sheets, key);
  const ws = XLSX.utils.aoa_to_sheet([g.header, ...g.rows]);
  ws["!freeze"] = { xSplit: 3, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, "Gradebook");
  const ia = itemAnalysisRows(rep);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ia.header, ...ia.rows]), "Item analysis");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Exam", key.examId], ["Key version", key.version], ["Students", rep.n], ["Items (KR-20)", rep.k],
    ["Mean", rep.mean], ["SD", rep.sd], ["Median", rep.median], ["Min", rep.min], ["Max", rep.max], ["KR-20", rep.kr20], ["SEM", rep.sem],
  ]), "Summary");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Registrar preset: roll number, name (from the class list) and the final grade on the exam's grading scale. */
export function finalGradesRows(sheets: readonly ScoredSheet[], roster: Roster | null): { header: string[]; rows: Cell[][] } {
  const rows = [...sheets]
    .sort((a, b) => (a.rollNumber ?? "\uffff").localeCompare(b.rollNumber ?? "\uffff", undefined, { numeric: true }))
    .map((s): Cell[] => [s.rollNumber ?? "", findStudent(roster, s.rollNumber)?.name ?? "", s.grade ?? ""]);
  return { header: ["Roll Number", "Name", "Final Grade"], rows };
}

/** One-sheet .xlsx of the final grades; a numeric scale (1.25, 2.00) is written as a number so the registrar can sort it. */
export function toFinalGradesWorkbook(XLSX: typeof import("xlsx"), t: { header: string[]; rows: Cell[][] }): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const numeric = t.rows.length > 0 && t.rows.every((r) => /^\d+(\.\d+)?$/.test(String(r[2])));
  const rows = numeric ? t.rows.map((r) => [r[0], r[1], Number(r[2])]) : t.rows;
  const ws = XLSX.utils.aoa_to_sheet([t.header, ...rows]);
  if (numeric) rows.forEach((_, i) => { const c = ws[XLSX.utils.encode_cell({ r: i + 1, c: 2 })]; if (c) c.z = "0.00"; });
  ws["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Final grades");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
