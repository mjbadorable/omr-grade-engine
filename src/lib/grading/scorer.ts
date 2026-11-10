/**
 * Pure, deterministic scoring.
 *
 *   compileKey(key)              → per-set lookup tables (done once per key version)
 *   scoreSheet(scan, key)        → ScoredSheet
 *   rescoreBatch(scans, key)     → ScoredSheet[]   (compiles once; ~O(sheets × questions))
 *
 * Choice answers are compared as bitmasks in MASTER option order after applying the sheet's
 * set mapping (question order + option permutation).
 */
import { isKeyed } from "./answer-key";
import type {
  AnswerKey, ChoiceRule, DomainScore, ItemNote, ItemStatus, MatrixRule, NumericRule, QuestionRule, QuestionScore, ScanInput, ScoredSheet, SetMapping,
} from "./types";

// ------------------------------------------------------------------ compiled key
interface CompiledQuestion {
  rule: QuestionRule;
  keyed: boolean;
  printed: number;
  /** printed option index → master option index (choice only) */
  perm: number[] | null;
  correctMask: number;              // master indices
  correctCount: number;
}
interface CompiledSet { label: string | null; questions: CompiledQuestion[]; identity: boolean }
export interface CompiledKey { key: AnswerKey; sets: Map<string, CompiledSet>; identity: CompiledSet; anyShuffled: boolean }

const maskOf = (idx: readonly number[]) => idx.reduce((m, i) => m | (1 << i), 0);
const bits = (m: number) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
const indicesOf = (m: number) => { const out: number[] = []; for (let i = 0; m; i++, m >>= 1) if (m & 1) out.push(i); return out; };

function compileSet(key: AnswerKey, label: string | null, map: SetMapping): CompiledSet {
  const masterToPrinted = new Map<number, number>();
  (map.questionOrder ?? []).forEach((master, i) => { if (master) masterToPrinted.set(master, i + 1); });
  const questions: CompiledQuestion[] = [];
  let identity = true;
  for (const rule of key.questions.values()) {
    const printed = masterToPrinted.get(rule.questionNumber) ?? rule.questionNumber;
    const perm = rule.type === "choice" ? map.optionPermutations?.[rule.questionNumber] ?? null : null;
    if (printed !== rule.questionNumber || (perm && perm.some((m, p) => m !== p))) identity = false;
    const correct = rule.type === "choice" ? rule.correct : [];
    questions.push({ rule, keyed: isKeyed(rule), printed, perm, correctMask: maskOf(correct), correctCount: correct.length });
  }
  return { label, questions, identity };
}

export function compileKey(key: AnswerKey): CompiledKey {
  const sets = new Map<string, CompiledSet>();
  for (const [label, m] of Object.entries(key.sets)) sets.set(label, compileSet(key, label, m));
  const identity = compileSet(key, null, {});
  return { key, sets, identity, anyShuffled: [...sets.values()].some((s) => !s.identity) };
}

// ------------------------------------------------------------------ helpers
const r2 = (v: number) => Math.round(v * 100) / 100;

export function gradeFor(percentage: number, bands: AnswerKey["gradeBands"]): string | null {
  let best: { minPercent: number; label: string } | null = null;
  for (const b of bands) if (percentage >= b.minPercent && (!best || b.minPercent > best.minPercent)) best = b;
  return best?.label ?? null;
}

function choiceOutcome(rule: ChoiceRule, sel: number, correctMask: number, correctCount: number): { status: ItemStatus; earned: number } {
  if (sel === 0) return { status: "OMITTED", earned: 0 };
  const wrong = (sel & ~correctMask) !== 0;
  switch (rule.mode) {
    case "ALL_MATCH":
      return sel === correctMask ? { status: "CORRECT", earned: rule.points } : { status: "INCORRECT", earned: -rule.negative };
    case "ANY_MATCH":
      return !wrong ? { status: "CORRECT", earned: rule.points } : { status: "INCORRECT", earned: -rule.negative };
    case "PARTIAL_CREDIT": {
      if (wrong) return { status: "INCORRECT", earned: -rule.negative };
      if (sel === correctMask) return { status: "CORRECT", earned: rule.points };
      return { status: "PARTIAL", earned: (rule.points * bits(sel & correctMask)) / correctCount };
    }
  }
}

function numericOutcome(rule: NumericRule, text: string | null): { status: ItemStatus; earned: number } {
  if (text === null || text === "") return { status: "OMITTED", earned: 0 };
  const v = Number(text);
  return Number.isFinite(v) && Math.abs(v - (rule.value as number)) <= rule.tolerance + 1e-9
    ? { status: "CORRECT", earned: rule.points }
    : { status: "INCORRECT", earned: -rule.negative };
}

function matrixOutcome(rule: MatrixRule, rows: Record<string, string[]> | null): { status: ItemStatus; earned: number } {
  const labels = Object.keys(rule.rows);
  if (!rows || labels.every((l) => !(rows[l]?.length))) return { status: "OMITTED", earned: 0 };
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const exact = labels.filter((l) => same(rows[l] ?? [], rule.rows[l])).length;
  if (exact === labels.length) return { status: "CORRECT", earned: rule.points };
  if (rule.mode === "PARTIAL_CREDIT" && exact > 0) return { status: "PARTIAL", earned: (rule.points * exact) / labels.length };
  return { status: "INCORRECT", earned: -rule.negative };
}

// ------------------------------------------------------------------ scoring
export function scoreWithCompiled(scan: ScanInput, ck: CompiledKey, index = 0): ScoredSheet {
  const { key } = ck;
  const f = scan.fields;
  const sheetFlags = f.conflicts.filter((c) => c.field === "roll" || c.field === "set").map((c) => c.code as string);

  let set: CompiledSet | undefined;
  let setUnknown = false;
  if (f.examSet && ck.sets.has(f.examSet)) set = ck.sets.get(f.examSet);
  else if (!ck.anyShuffled) set = (key.defaultSet && ck.sets.get(key.defaultSet)) || ck.identity;
  else { setUnknown = true; sheetFlags.push("SET_UNKNOWN"); }
  const questions = (set ?? ck.identity).questions;

  // index answers by printed number
  const answers = new Map(f.answers.map((a) => [a.questionNumber, a]));
  const numeric = new Map(f.numeric.map((a) => [a.questionNumber, a]));
  const matrix = new Map(f.matrix.map((a) => [a.questionNumber, a]));

  const items: QuestionScore[] = [];
  let total = 0, max = 0, nc = 0, ni = 0, no = 0, nf = 0, np = 0;
  const bySubject: Record<string, DomainScore> = {};
  const bySection: Record<string, DomainScore> = {};
  const bump = (bucket: Record<string, DomainScore>, tag: string | undefined, earned: number, mx: number, ok: boolean) => {
    if (!tag) return;
    const d = (bucket[tag] ??= { score: 0, max: 0, correct: 0, total: 0 });
    d.score += earned; d.max += mx; d.total++; if (ok) d.correct++;
  };

  for (const q of questions) {
    const rule = q.rule;
    const notes: ItemNote[] = [];
    let selected: number[] = [];
    let answerText: string | undefined;
    let status: ItemStatus;
    let earned = 0;
    let uncertain = false;
    let sel = 0;

    if (rule.type === "choice") {
      const a = answers.get(q.printed);
      if (a) {
        for (const p of a.marked) sel |= 1 << (q.perm ? q.perm[p] : p);
        uncertain = a.uncertain;
        if (a.marked.length > 1 && q.correctCount <= 1) notes.push("MULTIPLE_MARKS");
      }
      selected = indicesOf(sel);
    } else if (rule.type === "numeric") {
      const a = numeric.get(q.printed);
      answerText = a?.value ?? "";
      uncertain = !!a?.uncertain;
    } else {
      const a = matrix.get(q.printed);
      answerText = a ? Object.entries(a.rows).map(([r, c]) => `${r}:${c.join("")}`).join(" ") : "";
      uncertain = !!a?.uncertain;
    }

    const mx = rule.dropped || (!q.keyed && !rule.bonus) ? 0 : rule.points;
    if (rule.dropped) { status = "OMITTED"; notes.push("DROPPED"); }
    else if (rule.bonus) { status = "CORRECT"; earned = rule.points; notes.push("BONUS"); }
    else if (!q.keyed) { status = "OMITTED"; notes.push("UNKEYED"); }
    else if (setUnknown) { status = "FLAGGED_CONFLICT"; notes.push("SET_UNKNOWN"); }
    else if (uncertain && key.conflictPolicy === "zero") { status = "FLAGGED_CONFLICT"; notes.push("UNCERTAIN_MARK"); }
    else {
      if (uncertain) notes.push("UNCERTAIN_MARK");
      const o = rule.type === "choice" ? choiceOutcome(rule, sel, q.correctMask, q.correctCount)
        : rule.type === "numeric" ? numericOutcome(rule, answerText ?? null)
        : matrixOutcome(rule, matrix.get(q.printed)?.rows ?? null);
      status = o.status;
      earned = o.earned;
    }

    const isCorrect = status === "CORRECT";
    total += earned;
    max += mx;
    if (!rule.dropped) {
      if (status === "CORRECT") nc++;
      else if (status === "INCORRECT") ni++;
      else if (status === "PARTIAL") np++;
      else if (status === "FLAGGED_CONFLICT") nf++;
      else no++;
      bump(bySubject, rule.tags.subject, earned, mx, isCorrect);
      bump(bySection, rule.tags.section, earned, mx, isCorrect);
    }
    const correct = rule.type === "choice" ? rule.correct : [];
    const labels = rule.type === "choice" ? rule.optionLabels : [];
    items.push({
      questionNumber: rule.questionNumber, printedNumber: q.printed,
      selected, selectedLabels: selected.map((i) => labels[i] ?? String(i)),
      correct, correctLabels: rule.type === "choice" ? correct.map((i) => labels[i] ?? String(i))
        : rule.type === "numeric" ? (rule.value === null ? [] : [String(rule.value)])
        : Object.entries(rule.rows).map(([r, c]) => `${r}:${c.join("")}`),
      ...(answerText !== undefined ? { answerText } : {}),
      isCorrect, scoreEarned: r2(earned), maxScore: mx, status, notes,
    });
  }

  for (const d of [...Object.values(bySubject), ...Object.values(bySection)]) { d.score = r2(d.score); }
  const percentage = max > 0 ? r2((100 * total) / max) : 0;
  return {
    sheetId: scan.sheetId ?? `sheet-${f.rollNumber ?? index + 1}`,
    rollNumber: f.rollNumber,
    examSet: f.examSet,
    keyVersion: key.version,
    totalScore: r2(total),
    maxScore: r2(max),
    percentage,
    grade: gradeFor(percentage, key.gradeBands),
    correctCount: nc,
    incorrectCount: ni,
    omittedCount: no,
    flaggedCount: nf,
    accuracy: nc + ni + np > 0 ? Math.round((nc / (nc + ni + np)) * 10000) / 10000 : 0,
    items,
    bySubject,
    bySection,
    sheetFlags,
  };
}

export function scoreSheet(scan: ScanInput, key: AnswerKey): ScoredSheet {
  return scoreWithCompiled(scan, compileKey(key));
}

export function rescoreBatch(scans: readonly ScanInput[], key: AnswerKey): ScoredSheet[] {
  const ck = compileKey(key);
  const out = new Array<ScoredSheet>(scans.length);
  for (let i = 0; i < scans.length; i++) out[i] = scoreWithCompiled(scans[i], ck, i);
  return out;
}

/**
 * Combine the pages of one student's multi-page sheet into a single ScanInput.
 * Roll/set come from the first page that has them; answers from later pages win on overlap.
 */
export function mergePages(pages: readonly ScanInput[], sheetId?: string): ScanInput {
  const by = <T extends { questionNumber: number }>(get: (p: ScanInput) => T[]) => {
    const m = new Map<number, T>();
    for (const p of pages) for (const a of get(p)) m.set(a.questionNumber, a);
    return [...m.values()].sort((a, b) => a.questionNumber - b.questionNumber);
  };
  const first = pages.find((p) => p.fields.rollDigits.length > 0) ?? pages[0];
  return {
    sheetId: sheetId ?? first?.sheetId,
    layoutHash: first?.layoutHash,
    fields: {
      rollNumber: first?.fields.rollNumber ?? null,
      rollDigits: first?.fields.rollDigits ?? [],
      examSet: pages.find((p) => p.fields.examSet)?.fields.examSet ?? null,
      answers: by((p) => p.fields.answers),
      numeric: by((p) => p.fields.numeric),
      matrix: by((p) => p.fields.matrix),
      conflicts: pages.flatMap((p) => p.fields.conflicts),
    },
  };
}
