/**
 * Outcomes-Based Education attainment: how well the cohort did on the questions that measure each
 * course outcome (CO), rolled up to the department's program outcomes (PO A–I).
 *
 *   CO attainment % = points scored on the CO's questions ÷ points possible × 100  (all graded sheets)
 *
 * Bonus and dropped questions are excluded (they carry no evidence about the outcome). Negative
 * marking can push a sheet's earned points below zero on a CO; the cohort figure is clamped at 0.
 */
import type { AnswerKey, ScoredSheet } from "@/lib/grading/types";
import { ATTAINMENT_TARGET, type CourseOutcome, type ProgramOutcome } from "./types";

export interface CoAttainment {
  code: string;
  description: string;
  programOutcomes: string[];
  items: number;
  earned: number;
  possible: number;
  /** null when no question measures this CO */
  percent: number | null;
  /** true / false against the target; null when unmeasured */
  met: boolean | null;
}
export interface PoAttainment {
  code: string;
  description: string;
  contributingCOs: string[];
  earned: number;
  possible: number;
  percent: number | null;
  met: boolean | null;
}
export interface AttainmentReport {
  n: number;
  target: number;
  courseOutcomes: CoAttainment[];
  programOutcomes: PoAttainment[];
  /** scored questions that carry no outcome code */
  unmappedItems: number;
  belowTarget: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (earned: number, possible: number) => (possible > 0 ? r1(Math.max(0, Math.min(100, (earned / possible) * 100))) : null);

export function computeAttainment(
  sheets: readonly ScoredSheet[],
  key: AnswerKey,
  syllabus: { courseOutcomes: readonly CourseOutcome[]; programOutcomes: readonly ProgramOutcome[] } | null,
  target = ATTAINMENT_TARGET,
): AttainmentReport {
  const acc = new Map<string, { earned: number; possible: number; items: Set<number> }>();
  const touch = (code: string) => { let a = acc.get(code); if (!a) acc.set(code, (a = { earned: 0, possible: 0, items: new Set() })); return a; };
  const unmapped = new Set<number>();

  for (const [q, rule] of key.questions) {
    if (rule.dropped || rule.bonus) continue;
    if (!rule.outcomeCode) { unmapped.add(q); continue; }
    touch(rule.outcomeCode).items.add(q);
  }
  for (const sheet of sheets) {
    for (const item of sheet.items) {
      const rule = key.questions.get(item.questionNumber);
      if (!rule?.outcomeCode || rule.dropped || rule.bonus) continue;
      const a = touch(rule.outcomeCode);
      a.earned += item.scoreEarned;
      a.possible += item.maxScore;
    }
  }

  const defined = new Map((syllabus?.courseOutcomes ?? []).map((c) => [c.code, c]));
  const codes = [...new Set([...defined.keys(), ...acc.keys()])].sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  const courseOutcomes: CoAttainment[] = codes.map((code) => {
    const a = acc.get(code);
    const percent = a ? pct(a.earned, a.possible) : null;
    return {
      code, description: defined.get(code)?.description ?? "", programOutcomes: defined.get(code)?.programOutcomes ?? [],
      items: a?.items.size ?? 0, earned: r1(Math.max(0, a?.earned ?? 0)), possible: r1(a?.possible ?? 0),
      percent, met: percent === null ? null : percent >= target,
    };
  });

  // PO roll-up: every CO adds its points to each PO it supports (point-weighted, so a PO is not
  // dragged around by a CO measured by a single question).
  const poDefs = new Map((syllabus?.programOutcomes ?? []).map((p) => [p.code, p]));
  const poAcc = new Map<string, { earned: number; possible: number; cos: string[] }>();
  for (const co of courseOutcomes) {
    if (!co.possible) continue;
    for (const po of co.programOutcomes) {
      const a = poAcc.get(po) ?? { earned: 0, possible: 0, cos: [] };
      a.earned += co.earned; a.possible += co.possible; a.cos.push(co.code);
      poAcc.set(po, a);
    }
  }
  const poCodes = [...new Set([...poDefs.keys(), ...poAcc.keys()])].sort();
  const programOutcomes: PoAttainment[] = poCodes.map((code) => {
    const a = poAcc.get(code);
    const percent = a ? pct(a.earned, a.possible) : null;
    return { code, description: poDefs.get(code)?.description ?? "", contributingCOs: a?.cos ?? [], earned: r1(a?.earned ?? 0), possible: r1(a?.possible ?? 0), percent, met: percent === null ? null : percent >= target };
  });

  return {
    n: sheets.length, target, courseOutcomes, programOutcomes, unmappedItems: unmapped.size,
    belowTarget: courseOutcomes.filter((c) => c.met === false).map((c) => c.code),
  };
}
