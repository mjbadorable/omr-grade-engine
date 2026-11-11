/**
 * Mapping between Convex documents (string-keyed records, Id strings) and the domain contracts
 * (Map-based AnswerKey, ManualOverridePatch, ConflictResolution). Used on both sides: inside
 * Convex functions and in the React client, so the conversion has exactly one definition.
 */
import type { AnswerKey, QuestionRule, SetMapping } from "@/lib/grading/types";
import type { ManualOverridePatch } from "@/lib/review/overrides";
import type { ConflictResolution } from "@/lib/sync/types";
import { bubbleRefs } from "@/lib/vision/read-bubbles";
import type { BubbleReadout } from "@/lib/vision/types";
import type { OMRPage } from "@/lib/omr/schema";

export interface AnswerKeyBody {
  questions: Record<string, QuestionRule>;
  sets: Record<string, { questionOrder?: number[]; optionPermutations?: Record<string, number[]> }>;
  defaultSet: string | null;
  gradeBands: { minPercent: number; label: string }[];
  conflictPolicy: "zero" | "score-filled";
}

export function answerKeyToBody(k: AnswerKey): AnswerKeyBody {
  const questions: Record<string, QuestionRule> = {};
  for (const [n, r] of k.questions) questions[String(n)] = stripUndefined(r);
  const sets: AnswerKeyBody["sets"] = {};
  for (const [label, m] of Object.entries(k.sets)) {
    sets[label] = {
      ...(m.questionOrder ? { questionOrder: [...m.questionOrder] } : {}),
      ...(m.optionPermutations ? { optionPermutations: Object.fromEntries(Object.entries(m.optionPermutations).map(([q, p]) => [String(q), [...p]])) } : {}),
    };
  }
  return { questions, sets, defaultSet: k.defaultSet, gradeBands: k.gradeBands.map((b) => ({ ...b })), conflictPolicy: k.conflictPolicy };
}

export function bodyToAnswerKey(body: AnswerKeyBody, meta: { examId: string; version: number; layoutHash?: string }): AnswerKey {
  const questions = new Map<number, QuestionRule>(
    Object.entries(body.questions).map(([n, r]) => [Number(n), r] as const).sort((a, b) => a[0] - b[0]),
  );
  const sets: Record<string, SetMapping> = {};
  for (const [label, m] of Object.entries(body.sets)) {
    sets[label] = {
      ...(m.questionOrder ? { questionOrder: m.questionOrder } : {}),
      ...(m.optionPermutations ? { optionPermutations: Object.fromEntries(Object.entries(m.optionPermutations).map(([q, p]) => [Number(q), p])) } : {}),
    };
  }
  return { examId: meta.examId, version: meta.version, layoutHash: meta.layoutHash, questions, sets, defaultSet: body.defaultSet, gradeBands: body.gradeBands, conflictPolicy: body.conflictPolicy };
}

/** Convex rejects `undefined` inside stored objects. */
function stripUndefined<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

export interface OverrideRow {
  _id: string;
  scanId: string;
  patchId: string;
  target: ManualOverridePatch["target"];
  questionNumber: number;
  originalState: ManualOverridePatch["originalState"];
  overriddenOption: ManualOverridePatch["overriddenOption"];
  reason: string;
  teacherId: string;
  timestamp: number;
}

export function overrideRowToPatch(r: OverrideRow): ManualOverridePatch {
  return { id: r.patchId, sheetId: r.scanId, target: r.target, questionNumber: r.questionNumber, originalState: r.originalState, overriddenOption: r.overriddenOption, reason: r.reason, timestamp: r.timestamp, teacherId: r.teacherId };
}

export interface ResolutionRow { _id: string; examId: string; rollKey: string; keepScanId: string; supersededScanIds: string[]; teacherId: string; timestamp: number }
export function resolutionRowToDomain(r: ResolutionRow, layoutHash: string): ConflictResolution {
  return { id: r._id, layoutHash, rollKey: r.rollKey, keepSheetId: r.keepScanId, supersededSheetIds: r.supersededScanIds, teacherId: r.teacherId, timestamp: r.timestamp };
}

// ---- compact bubble readouts
const STATE_CODE = { FILLED: "F", PARTIAL: "P", ERASURE: "X", EMPTY: "E" } as const;
const CODE_STATE = { F: "FILLED", P: "PARTIAL", X: "ERASURE", E: "EMPTY" } as const;

export interface CompactReadouts { states: string; density: number[]; confidence: number[] }

/** Pack readouts in the template's canonical bubble order (missing bubbles → empty, 0). */
export function compactReadouts(page: OMRPage, readouts: readonly BubbleReadout[]): CompactReadouts {
  const byId = new Map(readouts.map((b) => [b.bubbleId, b]));
  let states = "";
  const density: number[] = [];
  const confidence: number[] = [];
  for (const ref of bubbleRefs(page)) {
    const b = byId.get(ref.id);
    states += b ? STATE_CODE[b.state] : "E";
    density.push(b ? Math.round(b.density * 1000) / 1000 : 0);
    confidence.push(b ? Math.round(b.confidence * 1000) / 1000 : 0);
  }
  return { states, density, confidence };
}

export function expandReadouts(page: OMRPage, c: CompactReadouts): Pick<BubbleReadout, "bubbleId" | "field" | "questionIndex" | "optionIndex" | "state" | "density" | "confidence">[] {
  return bubbleRefs(page).map((ref, i) => ({
    bubbleId: ref.id, field: ref.field, questionIndex: ref.questionIndex, optionIndex: ref.optionIndex,
    state: CODE_STATE[(c.states[i] ?? "E") as keyof typeof CODE_STATE], density: c.density[i] ?? 0, confidence: c.confidence[i] ?? 0,
  }));
}
