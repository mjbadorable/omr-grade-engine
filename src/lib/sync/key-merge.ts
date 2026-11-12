/**
 * Three-way merge of answer keys for offline edits.
 *
 * Two teachers start from the same key version (`base`). One saves first (`theirs`, the current
 * server key); the other was offline and now replays `mine`. Per question, and for each of the
 * key-level settings:
 *   - only I changed it            → keep mine
 *   - only they changed it         → keep theirs
 *   - both changed it identically  → keep it
 *   - both changed it differently  → real conflict: the server's value (already live for everyone
 *                                     and possibly already used for grading) wins, and the conflict
 *                                     is reported so the teacher can re-apply their change on purpose.
 * Without a base (unknown starting version) every difference counts as a conflict for the questions
 * both sides have, so nothing the other teacher saved is silently overwritten.
 */
import type { AnswerKeyBody } from "@/lib/cloud/convert";

export interface KeyConflict { scope: string; mine: unknown; theirs: unknown }
export interface KeyMergeResult {
  merged: AnswerKeyBody;
  /** questions / settings where my edit was applied on top of the server key */
  applied: string[];
  conflicts: KeyConflict[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function pick<T>(scope: string, base: T | undefined, mine: T | undefined, theirs: T | undefined, hasBase: boolean, out: { applied: string[]; conflicts: KeyConflict[] }): T | undefined {
  if (same(mine, theirs)) return theirs;
  if (hasBase) {
    if (same(mine, base)) return theirs;                    // I did not touch it
    if (same(theirs, base)) { out.applied.push(scope); return mine; } // only I touched it
  }
  out.conflicts.push({ scope, mine, theirs });
  return theirs;
}

export function mergeKeys(base: AnswerKeyBody | null, mine: AnswerKeyBody, theirs: AnswerKeyBody): KeyMergeResult {
  const out = { applied: [] as string[], conflicts: [] as KeyConflict[] };
  const hasBase = !!base;
  const questions: AnswerKeyBody["questions"] = {};
  for (const n of Object.keys(theirs.questions)) {
    const m = pick(`Q${n}`, base?.questions[n], mine.questions[n], theirs.questions[n], hasBase, out);
    if (m) questions[n] = m;
  }
  const merged: AnswerKeyBody = {
    questions,
    sets: pick("sets", base?.sets, mine.sets, theirs.sets, hasBase, out) ?? theirs.sets,
    defaultSet: pick("defaultSet", base?.defaultSet, mine.defaultSet, theirs.defaultSet, hasBase, out) ?? null,
    gradeBands: pick("gradeBands", base?.gradeBands, mine.gradeBands, theirs.gradeBands, hasBase, out) ?? theirs.gradeBands,
    conflictPolicy: pick("conflictPolicy", base?.conflictPolicy, mine.conflictPolicy, theirs.conflictPolicy, hasBase, out) ?? theirs.conflictPolicy,
  };
  return { merged, ...out };
}

export const describeMerge = (r: Pick<KeyMergeResult, "applied" | "conflicts">): string => {
  const parts = [r.applied.length ? `${r.applied.length} of your offline edits were applied on top of the newer key` : "your offline edits matched the newer key"];
  if (r.conflicts.length) parts.push(`${r.conflicts.length} conflicted with another teacher's edit (${r.conflicts.slice(0, 5).map((c) => c.scope).join(", ")}${r.conflicts.length > 5 ? ", …" : ""}); their value was kept, re-apply yours if needed`);
  return `${parts.join("; ")}.`;
};
