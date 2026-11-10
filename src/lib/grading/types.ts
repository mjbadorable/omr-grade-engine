/**
 * Grading contracts (Sprint 3). Pure data: no React, no OpenCV, no I/O.
 *
 * Question numbering:
 *   - "master" question number = the question in the answer key (Set A order).
 *   - "printed" question number = what the student saw on their set's question paper.
 *   A SetMapping translates printed → master (question order and option shuffles), so one
 *   key grades every set.
 * Option indices are 0-based positions (A = 0, B = 1, …) in MASTER order unless noted.
 */
import type { DecodedFields } from "@/lib/vision/types";

// ------------------------------------------------------------------ answer key
export type MatchMode =
  /** selected set must equal the correct set exactly */
  | "ALL_MATCH"
  /** any non-empty subset of the correct options earns full points (no wrong option allowed) */
  | "ANY_MATCH"
  /** points × |selected ∩ correct| / |correct| when no wrong option is selected */
  | "PARTIAL_CREDIT";

interface RuleBase {
  questionNumber: number;           // master number
  points: number;                   // awarded for a correct answer (≥ 0)
  negative: number;                 // deducted for a wrong answer (≥ 0, applied as −negative)
  /** everyone receives full points (even blank / wrong); excluded from item statistics */
  bonus: boolean;
  /** removed from the test: no score, no max, no statistics */
  dropped: boolean;
  tags: { subject?: string; section?: string };
}

export interface ChoiceRule extends RuleBase {
  type: "choice";
  optionCount: number;
  optionLabels: string[];
  correct: number[];                // master option indices
  mode: MatchMode;
}

export interface NumericRule extends RuleBase {
  type: "numeric";
  value: number | null;             // null = not keyed yet
  tolerance: number;                // |answer − value| ≤ tolerance is correct
}

export interface MatrixRule extends RuleBase {
  type: "matrix";
  /** row label → correct column labels */
  rows: Record<string, string[]>;
  mode: Exclude<MatchMode, "ANY_MATCH">; // ALL_MATCH: every row exact; PARTIAL_CREDIT: fraction of exact rows
}

export type QuestionRule = ChoiceRule | NumericRule | MatrixRule;

/** Printed → master translation for one exam set. Identity when fields are omitted. */
export interface SetMapping {
  /** questionOrder[printed − 1] = master question number */
  questionOrder?: number[];
  /** master question number → permutation; perm[printedOptionIndex] = masterOptionIndex */
  optionPermutations?: Record<number, number[]>;
}

export interface GradeBand { minPercent: number; label: string }

export interface AnswerKey {
  examId: string;
  version: number;
  /** template the key was made for (optional guard against grading the wrong sheets) */
  layoutHash?: string;
  questions: ReadonlyMap<number, QuestionRule>;
  /** set label (e.g. "A") → mapping; sets not listed use the identity mapping */
  sets: Readonly<Record<string, SetMapping>>;
  /** used when a sheet has no readable set and the key does not depend on the set */
  defaultSet: string | null;
  /** tiered grading, any order; highest band whose minPercent ≤ percentage wins */
  gradeBands: GradeBand[];
  /** how uncertain (partial / unclear) answers are scored before teacher review */
  conflictPolicy: "zero" | "score-filled";
}

// ------------------------------------------------------------------ scored output
export type ItemStatus = "CORRECT" | "INCORRECT" | "OMITTED" | "FLAGGED_CONFLICT" | "PARTIAL";
export type ItemNote = "BONUS" | "DROPPED" | "UNKEYED" | "MULTIPLE_MARKS" | "UNCERTAIN_MARK" | "SET_UNKNOWN";

export interface QuestionScore {
  questionNumber: number;           // master
  printedNumber: number;
  /** selected options in master indices (choice) */
  selected: number[];
  selectedLabels: string[];
  correct: number[];
  correctLabels: string[];
  /** numeric/matrix raw answer rendered as text */
  answerText?: string;
  isCorrect: boolean;
  scoreEarned: number;
  maxScore: number;
  status: ItemStatus;
  notes: ItemNote[];
}

export interface DomainScore { score: number; max: number; correct: number; total: number }

export interface ScoredSheet {
  sheetId: string;
  rollNumber: string | null;
  examSet: string | null;
  keyVersion: number;
  totalScore: number;
  maxScore: number;
  percentage: number;               // 0..100, 2 decimals
  grade: string | null;
  correctCount: number;
  incorrectCount: number;
  omittedCount: number;
  flaggedCount: number;
  /** correct / attempted (0..1) */
  accuracy: number;
  items: QuestionScore[];
  bySubject: Record<string, DomainScore>;
  bySection: Record<string, DomainScore>;
  /** sheet-level problems (roll/set conflicts from the scanner, unknown set …) */
  sheetFlags: string[];
}

/** What the scorer needs from a scan: the decoded fields (+ optional identity). */
export interface ScanInput {
  sheetId?: string;
  layoutHash?: string;
  fields: DecodedFields;
}

// ------------------------------------------------------------------ psychometrics
export type ItemQuality = "STRONG" | "AVERAGE" | "POOR";
export type ItemFlag = "LOW_DISCRIMINATION" | "NEGATIVE_DISCRIMINATION" | "POSSIBLE_MISKEY" | "TOO_EASY" | "TOO_HARD";

export interface DistractorStat {
  optionIndex: number;
  label: string;
  isKey: boolean;
  count: number;
  upper: number;                    // count in the upper group
  lower: number;                    // count in the lower group
  proportion: number;               // count / N
  upperProportion: number;
  lowerProportion: number;
  flag: "MISLEADING" | "NON_FUNCTIONAL" | null;
}

export interface ItemStatistics {
  questionNumber: number;
  type: QuestionRule["type"];
  n: number;
  correct: number;
  /** difficulty index p = N_correct / N */
  p: number;
  pUpper: number;
  pLower: number;
  /** discrimination index D = p_upper − p_lower (27 % groups) */
  d: number;
  /** point-biserial with the total score */
  rpbis: number | null;
  /** point-biserial with the rest score (total − this item); not inflated by self-correlation */
  rpbisCorrected: number | null;
  omitted: number;
  distractors: DistractorStat[];
  quality: ItemQuality;
  flags: ItemFlag[];
}

export interface PsychometricReport {
  keyVersion: number;
  n: number;
  /** items included in KR-20 (keyed, not bonus/dropped) */
  k: number;
  groupSize: number;                // students in each 27 % group
  mean: number;
  sd: number;                       // population SD of total score
  median: number;
  min: number;
  max: number;
  /** KR-20 on dichotomous item scores; null when undefined (k < 2 or zero variance) */
  kr20: number | null;
  /** standard error of measurement on the dichotomous scale */
  sem: number | null;
  items: ItemStatistics[];
}
