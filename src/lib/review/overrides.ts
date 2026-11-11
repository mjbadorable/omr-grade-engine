/**
 * Audit-logged manual overrides.
 *
 * The scanner's DecodedFields are never mutated. A teacher's correction is an append-only
 * ManualOverridePatch; `applyOverrides` folds the patches over the raw fields to produce the
 * effective fields used for scoring. For each target the newest patch wins (timestamp, then id),
 * and a patch with `overriddenOption: null` reverts that target to the scanner's reading.
 */
import type { AnswerDecode, DecodedFields, FieldConflict } from "@/lib/vision/types";

export type OverrideTarget = "answer" | "roll" | "set" | "numeric";

export interface ManualOverridePatch {
  id: string;
  sheetId: string;
  target: OverrideTarget;
  /** printed question number for answer/numeric targets; 0 for roll/set */
  questionNumber: number;
  /** what the scanner read (snapshot for the audit trail) */
  originalState: { marked?: number[]; labels?: string[]; value?: string | null; uncertain?: boolean };
  /**
   * answer: option indices (printed order), [] = deliberately blank
   * roll / set / numeric: the corrected string
   * null: revert to the scanner's reading
   */
  overriddenOption: number[] | string | null;
  reason: string;
  timestamp: number;
  teacherId: string;
}

const targetKey = (p: Pick<ManualOverridePatch, "target" | "questionNumber">) => `${p.target}:${p.questionNumber}`;

/** Newest patch per target (ties broken by id so every device folds identically). */
export function effectivePatches(patches: readonly ManualOverridePatch[]): Map<string, ManualOverridePatch> {
  const out = new Map<string, ManualOverridePatch>();
  for (const p of patches) {
    const k = targetKey(p);
    const cur = out.get(k);
    if (!cur || p.timestamp > cur.timestamp || (p.timestamp === cur.timestamp && p.id > cur.id)) out.set(k, p);
  }
  for (const [k, p] of out) if (p.overriddenOption === null) out.delete(k);
  return out;
}

export function applyOverrides(raw: DecodedFields, patches: readonly ManualOverridePatch[]): DecodedFields {
  if (!patches.length) return raw;
  const eff = effectivePatches(patches);
  if (!eff.size) return raw;

  let rollNumber = raw.rollNumber;
  let rollDigits = raw.rollDigits;
  let examSet = raw.examSet;
  const resolved = new Set<string>(); // conflict keys cleared by a teacher decision

  const roll = eff.get("roll:0");
  if (roll && typeof roll.overriddenOption === "string") {
    rollNumber = roll.overriddenOption;
    rollDigits = [...roll.overriddenOption];
    resolved.add("roll");
  }
  const set = eff.get("set:0");
  if (set && typeof set.overriddenOption === "string") {
    examSet = set.overriddenOption || null;
    resolved.add("set");
  }

  const answers: AnswerDecode[] = raw.answers.map((a) => {
    const p = eff.get(`answer:${a.questionNumber}`);
    if (!p || !Array.isArray(p.overriddenOption)) return a;
    resolved.add(`answer:${a.questionNumber}`);
    const marked = [...p.overriddenOption].sort((x, y) => x - y);
    return { ...a, marked, labels: marked.map((i) => a.labels[a.marked.indexOf(i)] ?? String.fromCharCode(65 + i)), uncertain: false };
  });
  // overrides for questions the scanner did not report at all (e.g. a page not scanned)
  for (const [k, p] of eff) {
    if (p.target !== "answer" || !Array.isArray(p.overriddenOption) || answers.some((a) => a.questionNumber === p.questionNumber)) continue;
    resolved.add(k);
    const marked = [...p.overriddenOption].sort((x, y) => x - y);
    answers.push({ questionNumber: p.questionNumber, marked, labels: marked.map((i) => String.fromCharCode(65 + i)), uncertain: false });
  }
  answers.sort((x, y) => x.questionNumber - y.questionNumber);

  const numeric = raw.numeric.map((n) => {
    const p = eff.get(`numeric:${n.questionNumber}`);
    if (!p || typeof p.overriddenOption !== "string") return n;
    resolved.add(`numeric:${n.questionNumber}`);
    return { ...n, value: p.overriddenOption === "" ? null : p.overriddenOption, uncertain: false };
  });

  const conflicts: FieldConflict[] = raw.conflicts.filter((c) => {
    if (c.field === "roll") return !resolved.has("roll");
    if (c.field === "set") return !resolved.has("set");
    if (c.field === "answer") return !resolved.has(`answer:${c.index}`);
    if (c.field === "numeric") return !resolved.has(`numeric:${c.index}`);
    return true;
  });

  return { ...raw, rollNumber, rollDigits, examSet, answers, numeric, conflicts };
}

export function makePatch(input: Omit<ManualOverridePatch, "id" | "timestamp"> & { id?: string; timestamp?: number }): ManualOverridePatch {
  return {
    ...input,
    id: input.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    timestamp: input.timestamp ?? Date.now(),
  };
}

/** Human-readable audit line. */
export function describePatch(p: ManualOverridePatch): string {
  const what = p.target === "answer" ? `Q${p.questionNumber}` : p.target === "numeric" ? `Q${p.questionNumber} (numeric)` : p.target === "roll" ? "roll number" : "exam set";
  const from = p.originalState.labels?.join("") || p.originalState.value || "blank";
  const to = p.overriddenOption === null ? "scanner reading"
    : Array.isArray(p.overriddenOption) ? (p.overriddenOption.map((i) => String.fromCharCode(65 + i)).join("") || "blank")
    : p.overriddenOption || "blank";
  return `${new Date(p.timestamp).toISOString().replace("T", " ").slice(0, 16)} · ${p.teacherId}: ${what} ${from} → ${to}${p.reason ? ` (“${p.reason}”)` : ""}`;
}
