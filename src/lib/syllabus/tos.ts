/**
 * Table of Specifications (TOS): how many exam questions each module of the selected term gets,
 * and which course outcome (CO) each question measures. Generated automatically from the
 * syllabus; teachers only nudge the sliders.
 */
import type { AnswerKey, QuestionRule } from "@/lib/grading/types";
import { PERIOD_MODULES, type ExamPeriod, type Syllabus } from "./types";

export interface TosRow {
  moduleNumber: number;
  title: string;
  courseOutcomes: string[];
  questions: number;
}
export interface Tos {
  period: ExamPeriod;
  totalQuestions: number;
  rows: TosRow[];
}
export interface QuestionOutcome { questionNumber: number; moduleNumber: number; outcomeCode: string | null }

/** Largest-remainder apportionment of `total` over non-negative weights (sums exactly to total). */
export function distribute(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wsum = sum > 0 ? sum : n;
  const exact = w.map((x) => (x / wsum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i]++;
  return out;
}

/** Modules of the period; when the syllabus lacks some, only the ones that exist take questions. */
export function modulesForPeriod(s: Syllabus, period: ExamPeriod) {
  const wanted = new Set(PERIOD_MODULES[period]);
  return s.modules.filter((m) => wanted.has(m.number)).sort((a, b) => a.number - b.number);
}

/** Default split is proportional to teaching hours when every module has them, else to topic count (min 1). */
export function generateTos(s: Syllabus, period: ExamPeriod, totalQuestions: number): Tos {
  const mods = modulesForPeriod(s, period);
  const useHours = mods.length > 0 && mods.every((m) => (m.hours ?? 0) > 0);
  const weights = mods.map((m) => (useHours ? m.hours! : Math.max(1, m.topics.length)));
  const counts = distribute(totalQuestions, weights);
  return {
    period, totalQuestions,
    rows: mods.map((m, i) => ({ moduleNumber: m.number, title: m.title, courseOutcomes: m.courseOutcomes, questions: counts[i] })),
  };
}

/**
 * Slider edit: module `moduleNumber` gets `count` questions (clamped), the remaining questions are
 * re-spread over the other modules in proportion to what they had, so the total never drifts.
 */
export function setModuleQuestions(tos: Tos, moduleNumber: number, count: number): Tos {
  const idx = tos.rows.findIndex((r) => r.moduleNumber === moduleNumber);
  if (idx < 0) return tos;
  const others = tos.rows.filter((_, i) => i !== idx);
  const c = Math.max(0, Math.min(tos.totalQuestions, Math.round(count)));
  if (!others.length) return { ...tos, rows: tos.rows.map((r) => ({ ...r, questions: tos.totalQuestions })) };
  const spread = distribute(tos.totalQuestions - c, others.map((r) => r.questions));
  let k = 0;
  return { ...tos, rows: tos.rows.map((r, i) => (i === idx ? { ...r, questions: c } : { ...r, questions: spread[k++] })) };
}

/** Change the exam length keeping the current proportions. */
export function resizeTos(tos: Tos, totalQuestions: number): Tos {
  const counts = distribute(totalQuestions, tos.rows.map((r) => r.questions));
  return { ...tos, totalQuestions, rows: tos.rows.map((r, i) => ({ ...r, questions: counts[i] })) };
}

/**
 * Question-by-question assignment: questions are numbered 1..N in module order; inside a module
 * the module's COs are cycled so each outcome is measured about equally.
 * A module with no listed CO falls back to the syllabus's COs.
 */
export function assignOutcomes(tos: Tos, s: Syllabus, questionNumbers?: number[]): QuestionOutcome[] {
  const numbers = questionNumbers ?? Array.from({ length: tos.totalQuestions }, (_, i) => i + 1);
  const all = s.courseOutcomes.map((c) => c.code);
  const out: QuestionOutcome[] = [];
  let at = 0;
  for (const row of tos.rows) {
    const pool = row.courseOutcomes.length ? row.courseOutcomes : all;
    for (let i = 0; i < row.questions && at < numbers.length; i++, at++) {
      out.push({ questionNumber: numbers[at], moduleNumber: row.moduleNumber, outcomeCode: pool.length ? pool[i % pool.length] : null });
    }
  }
  return out;
}

/** Stamp outcome + module onto the key's rules (one new key version). Questions beyond the TOS are untouched. */
export function applyOutcomesToKey(key: AnswerKey, assignments: readonly QuestionOutcome[]): AnswerKey {
  const by = new Map(assignments.map((a) => [a.questionNumber, a]));
  const questions = new Map<number, QuestionRule>();
  for (const [n, r] of key.questions) {
    const a = by.get(n);
    questions.set(n, a ? ({ ...r, moduleNumber: a.moduleNumber, ...(a.outcomeCode ? { outcomeCode: a.outcomeCode } : {}) } as QuestionRule) : r);
  }
  return { ...key, questions, version: key.version + 1 };
}

export const hasOutcomes = (key: AnswerKey) => [...key.questions.values()].some((r) => r.outcomeCode);
