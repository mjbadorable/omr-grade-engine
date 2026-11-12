/**
 * Bubble-grid answer-key editing (ZipGrade "Edit Key"). Pure helpers over QuestionRule.
 *
 * Several bubbles on one question = alternate credit: any ONE of them earns full points, so a
 * multi-bubble toggle moves an ALL_MATCH rule to ANY_MATCH (and back when only one is left).
 * An explicit PARTIAL_CREDIT choice made in the detailed table is never overwritten.
 */
import type { AnswerKey, ChoiceRule, QuestionRule, SetMapping } from "./types";

/** New correct list + match mode after clicking master option `i`. */
export function toggleCorrect(rule: ChoiceRule, i: number): Pick<ChoiceRule, "correct" | "mode"> {
  const correct = rule.correct.includes(i) ? rule.correct.filter((x) => x !== i) : [...rule.correct, i].sort((a, b) => a - b);
  let mode = rule.mode;
  if (correct.length > 1 && mode === "ALL_MATCH") mode = "ANY_MATCH";
  else if (correct.length <= 1 && mode === "ANY_MATCH") mode = "ALL_MATCH";
  return { correct, mode };
}

export interface GridRow {
  /** row label shown to the teacher: printed number in this set */
  printed: number;
  master: number;
  rule: ChoiceRule | null;
  /** printed option index → master option index (identity when the set does not shuffle options) */
  perm: number[];
}

/** Rows of the key as printed in `set` (printed order; options in printed order). Non-choice questions have rule = null. */
export function gridRows(key: AnswerKey, set: string | null): GridRow[] {
  const map: SetMapping = (set && key.sets[set]) || {};
  const masterToPrinted = new Map<number, number>();
  (map.questionOrder ?? []).forEach((master, i) => { if (master) masterToPrinted.set(master, i + 1); });
  const rows: GridRow[] = [];
  for (const rule of key.questions.values()) {
    const choice = rule.type === "choice" ? rule : null;
    const perm = choice ? map.optionPermutations?.[rule.questionNumber] ?? choice.optionLabels.map((_, i) => i) : [];
    rows.push({ printed: masterToPrinted.get(rule.questionNumber) ?? rule.questionNumber, master: rule.questionNumber, rule: choice, perm });
  }
  return rows.sort((a, b) => a.printed - b.printed);
}

/** Printed option indices that are correct for a row. */
export const correctPrinted = (row: GridRow): number[] => (row.rule ? row.perm.map((m, p) => (row.rule!.correct.includes(m) ? p : -1)).filter((p) => p >= 0) : []);

/** Click printed bubble `p` of a row → patch for the MASTER rule. */
export function toggleRowBubble(row: GridRow, p: number): Partial<QuestionRule> | null {
  if (!row.rule) return null;
  const m = row.perm[p];
  return m === undefined ? null : (toggleCorrect(row.rule, m) as Partial<QuestionRule>);
}

export const keyedCount = (key: AnswerKey) => [...key.questions.values()].filter((r) => r.type === "choice" && r.correct.length > 0).length;
