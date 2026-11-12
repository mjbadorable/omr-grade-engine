/** Instant-result summary shown right after a scan (ZipGrade-style banner). */
import { isKeyed } from "@/lib/grading/answer-key";
import { scoreSheet } from "@/lib/grading/scorer";
import type { AnswerKey, ScoredSheet } from "@/lib/grading/types";
import type { DecodedFields } from "@/lib/vision/types";

export interface InstantResult {
  rollNumber: string | null;
  examSet: string | null;
  keyed: boolean;
  score: number;
  max: number;
  percentage: number;
  /** "42 / 50 (84.0%)" */
  scoreText: string;
  /** double-marked / uncertain / conflicting items */
  doubleMarked: number;
  blank: number;
  flagged: number;
  grade: string | null;
  sheetFlags: string[];
}

export function summarizeScored(s: ScoredSheet, keyed = true): InstantResult {
  const doubleMarked = s.items.filter((i) => i.status === "FLAGGED_CONFLICT" || i.notes.includes("MULTIPLE_MARKS") || i.notes.includes("UNCERTAIN_MARK")).length;
  const blank = s.items.filter((i) => i.status === "OMITTED" && !i.notes.includes("BONUS") && !i.notes.includes("DROPPED") && !i.notes.includes("UNKEYED")).length;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
  return {
    rollNumber: s.rollNumber, examSet: s.examSet, keyed,
    score: s.totalScore, max: s.maxScore, percentage: s.percentage,
    scoreText: `${fmt(s.totalScore)} / ${fmt(s.maxScore)} (${s.percentage.toFixed(1)}%)`,
    doubleMarked, blank, flagged: doubleMarked + blank, grade: s.grade, sheetFlags: s.sheetFlags,
  };
}

/** Score a fresh scan against the key (null / unkeyed key → result without a meaningful score). */
export function instantResult(fields: DecodedFields, key: AnswerKey | null): InstantResult {
  const keyedAny = !!key && [...key.questions.values()].some(isKeyed);
  if (!key) {
    const blank = fields.answers.filter((a) => a.marked.length === 0).length;
    const dbl = fields.answers.filter((a) => a.marked.length > 1 || a.uncertain).length;
    return { rollNumber: fields.rollNumber, examSet: fields.examSet, keyed: false, score: 0, max: 0, percentage: 0, scoreText: "No answer key yet", doubleMarked: dbl, blank, flagged: dbl + blank, grade: null, sheetFlags: [] };
  }
  const r = summarizeScored(scoreSheet({ fields }, key), keyedAny);
  return keyedAny ? r : { ...r, scoreText: "No answer key yet" };
}
