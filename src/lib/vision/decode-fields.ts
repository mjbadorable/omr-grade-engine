/**
 * Field decoding + conflict flags (pure; consumes BubbleReadouts and the template page).
 *
 * Roll number / exam set: each column (set row) must contain exactly one FILLED bubble.
 *   0 FILLED → *_BLANK, >1 FILLED → *_MULTIPLE, any PARTIAL (or only ERASURE residue) → *_UNCERTAIN.
 *   An ERASURE next to exactly one FILLED bubble is the normal "changed my mind" case: accepted.
 * Answers: FILLED options are the answer; >1 → ANSWER_MULTIPLE, PARTIAL present → ANSWER_UNCERTAIN.
 *   Blank answers are not conflicts (grading decides).
 */
import type { OMRPage } from "@/lib/omr/schema";
import type { AnswerDecode, BubbleReadout, DecodedFields, FieldConflict, MatrixDecode, NumericDecode } from "./types";

type Group = BubbleReadout[];

function groupBy(bubbles: BubbleReadout[], key: (b: BubbleReadout) => string | null): Map<string, Group> {
  const m = new Map<string, Group>();
  for (const b of bubbles) {
    const k = key(b);
    if (k !== null) (m.get(k) ?? m.set(k, []).get(k)!).push(b);
  }
  for (const g of m.values()) g.sort((a, b) => a.optionIndex - b.optionIndex);
  return m;
}

const filled = (g: Group) => g.filter((b) => b.state === "FILLED");
const partial = (g: Group) => g.filter((b) => b.state === "PARTIAL");
const ids = (g: Group) => g.map((b) => b.bubbleId);

/** Single-choice column (roll digit / exam set) → chosen option index or a conflict. */
function singleChoice(g: Group): { choice: number | null; problem: "BLANK" | "MULTIPLE" | "UNCERTAIN" | null; culprits: Group } {
  const f = filled(g), p = partial(g);
  if (f.length > 1) return { choice: null, problem: "MULTIPLE", culprits: f };
  if (p.length > 0) return { choice: null, problem: "UNCERTAIN", culprits: [...f, ...p] };
  if (f.length === 1) return { choice: f[0].optionIndex, problem: null, culprits: [] };
  const residue = g.filter((b) => b.state === "ERASURE");
  return residue.length ? { choice: null, problem: "UNCERTAIN", culprits: residue } : { choice: null, problem: "BLANK", culprits: g };
}

export function decodeFields(page: OMRPage, bubbles: BubbleReadout[]): DecodedFields {
  const conflicts: FieldConflict[] = [];

  // ---- roll number
  const rollRegion = page.regions.find((r) => r.kind === "roll");
  let rollDigits: (string | null)[] = [];
  if (rollRegion && rollRegion.kind === "roll") {
    const cols = groupBy(bubbles, (b) => (b.field === "roll" ? String(b.questionIndex) : null));
    rollDigits = Array.from({ length: rollRegion.digits }, (_, d) => {
      const g = cols.get(String(d)) ?? [];
      const { choice, problem, culprits } = singleChoice(g);
      if (problem) {
        conflicts.push({
          code: `ROLL_DIGIT_${problem}`, field: "roll", index: d, bubbleIds: ids(culprits),
          message: problem === "BLANK" ? `Roll digit ${d + 1} is not marked`
            : problem === "MULTIPLE" ? `Roll digit ${d + 1} has ${culprits.length} marks`
            : `Roll digit ${d + 1} has an unclear mark`,
        });
        return null;
      }
      return rollRegion.symbols[choice!];
    });
  }
  const rollNumber = rollDigits.length && rollDigits.every((d) => d !== null) ? rollDigits.join("") : null;

  // ---- exam set
  let examSet: string | null = null;
  const setRegion = page.regions.find((r) => r.kind === "set");
  if (setRegion && setRegion.kind === "set") {
    const g = bubbles.filter((b) => b.field === "set").sort((a, b) => a.optionIndex - b.optionIndex);
    const { choice, problem, culprits } = singleChoice(g);
    if (problem) {
      conflicts.push({ code: `SET_${problem}`, field: "set", index: 0, bubbleIds: ids(culprits),
        message: problem === "BLANK" ? "Exam set is not marked" : problem === "MULTIPLE" ? "More than one exam set is marked" : "Exam set mark is unclear" });
    } else examSet = setRegion.options[choice!];
  }

  // ---- MCQ answers
  const answers: AnswerDecode[] = [];
  const qs = groupBy(bubbles, (b) => (b.field === "answer" ? String(b.questionIndex) : null));
  for (const region of page.regions) {
    if (region.kind !== "mcq") continue;
    for (const q of region.questions) {
      const g = qs.get(String(q.number - 1)) ?? [];
      const f = filled(g), p = partial(g);
      const marked = f.map((b) => b.optionIndex);
      answers.push({ questionNumber: q.number, marked, labels: marked.map((i) => q.options[i]), uncertain: p.length > 0 });
      if (f.length > 1) conflicts.push({ code: "ANSWER_MULTIPLE", field: "answer", index: q.number, bubbleIds: ids(f), message: `Question ${q.number} has ${f.length} marks` });
      else if (p.length) conflicts.push({ code: "ANSWER_UNCERTAIN", field: "answer", index: q.number, bubbleIds: ids([...f, ...p]), message: `Question ${q.number} has a partial mark` });
    }
  }

  // ---- numeric
  const numeric: NumericDecode[] = [];
  const matrix: MatrixDecode[] = [];
  for (const region of page.regions) {
    if (region.kind === "numeric") {
      const own = bubbles.filter((b) => b.field === "numeric" && b.questionIndex === region.questionNumber - 1);
      const uncertain = own.some((b) => b.state === "PARTIAL");
      const sign = own.find((b) => b.optionIndex === 200)?.state === "FILLED" ? "-" : "";
      let text = "";
      let invalid = false;
      for (let d = 0; d < region.digits; d++) {
        const digits = own.filter((b) => b.optionIndex >= d * 10 && b.optionIndex < d * 10 + 10 && b.state === "FILLED");
        const dot = own.find((b) => b.optionIndex === 100 + d)?.state === "FILLED";
        if (digits.length + (dot ? 1 : 0) > 1) invalid = true;
        else if (dot) text += ".";
        else if (digits.length === 1) text += String(digits[0].optionIndex - d * 10);
      }
      const value = text === "" ? null : sign + text;
      if (value !== null && !/^-?(\d+\.?\d*|\.\d+)$/.test(value)) invalid = true;
      if (invalid) conflicts.push({ code: "NUMERIC_INVALID", field: "numeric", index: region.questionNumber, bubbleIds: ids(own.filter((b) => b.state === "FILLED")), message: `Question ${region.questionNumber}: numeric entry is not a valid number` });
      numeric.push({ questionNumber: region.questionNumber, value: invalid ? null : value, uncertain });
    } else if (region.kind === "matrix") {
      const own = bubbles.filter((b) => b.field === "matrix" && b.questionIndex === region.questionNumber - 1);
      const rows: Record<string, string[]> = {};
      region.rows.forEach((rl, ri) => {
        rows[rl] = own.filter((b) => b.state === "FILLED" && Math.floor(b.optionIndex / region.cols.length) === ri)
          .sort((a, b) => a.optionIndex - b.optionIndex)
          .map((b) => region.cols[b.optionIndex % region.cols.length]);
      });
      matrix.push({ questionNumber: region.questionNumber, rows, uncertain: own.some((b) => b.state === "PARTIAL") });
    }
  }

  return { rollNumber, rollDigits, examSet, answers, numeric, matrix, conflicts };
}
