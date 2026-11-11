/**
 * Two-teacher conflict detection (pure).
 *
 * Sheets of the same template whose (effective) roll numbers resolve to the same rollKey form a
 * group. If their effective answers are identical the group is a harmless DUPLICATE_IDENTICAL
 * (the earliest sheet counts). If they differ it is DIVERGENT_ANSWERS and every sheet in the group
 * is held for administrative review until a ConflictResolution picks the one to keep. Nothing is
 * overwritten automatically.
 */
import { rollKey } from "@/lib/roster/schema";
import type { DecodedFields } from "@/lib/vision/types";
import type { ConflictResolution } from "./types";

export interface SyncedSheet {
  sheetId: string;
  layoutHash: string;
  deviceId: string;
  teacherId: string;
  createdAt: number;
  /** effective fields (overrides applied) */
  fields: DecodedFields;
}

export interface ConflictGroup {
  layoutHash: string;
  rollKey: string;
  rollNumber: string;
  sheetIds: string[];
  kind: "DUPLICATE_IDENTICAL" | "DIVERGENT_ANSWERS";
  /** sheets came from more than one device / teacher */
  crossDevice: boolean;
  teachers: string[];
  /** set when a resolution covers exactly this group's sheets */
  resolution: ConflictResolution | null;
  /** questions (printed numbers) whose answers differ between the sheets */
  differingQuestions: number[];
}

/** Stable digest of everything that affects the grade. */
export function answerDigest(f: DecodedFields): string {
  return JSON.stringify([
    f.examSet,
    f.answers.map((a) => [a.questionNumber, a.marked]),
    f.numeric.map((n) => [n.questionNumber, n.value]),
    f.matrix.map((m) => [m.questionNumber, Object.entries(m.rows).sort()]),
  ]);
}

export function detectConflicts(sheets: readonly SyncedSheet[], resolutions: readonly ConflictResolution[] = []): ConflictGroup[] {
  const groups = new Map<string, SyncedSheet[]>();
  for (const s of sheets) {
    const k = rollKey(s.fields.rollNumber);
    if (!k) continue;
    const gk = `${s.layoutHash}|${k}`;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(s);
  }
  const out: ConflictGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.createdAt - b.createdAt || a.sheetId.localeCompare(b.sheetId));
    const digests = new Set(list.map((s) => answerDigest(s.fields)));
    const ids = list.map((s) => s.sheetId);
    const k = rollKey(list[0].fields.rollNumber)!;
    // newest resolution that mentions any sheet of this group
    const res = [...resolutions].filter((r) => r.layoutHash === list[0].layoutHash && r.rollKey === k && ids.includes(r.keepSheetId))
      .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
    // a resolution only stands if it covers every current sheet (a newer scan reopens the case)
    const covered = res && ids.every((id) => id === res.keepSheetId || res.supersededSheetIds.includes(id));
    out.push({
      layoutHash: list[0].layoutHash, rollKey: k, rollNumber: list[0].fields.rollNumber ?? k, sheetIds: ids,
      kind: digests.size > 1 ? "DIVERGENT_ANSWERS" : "DUPLICATE_IDENTICAL",
      crossDevice: new Set(list.map((s) => s.deviceId)).size > 1,
      teachers: [...new Set(list.map((s) => s.teacherId))],
      resolution: covered ? res : null,
      differingQuestions: digests.size > 1 ? differing(list.map((s) => s.fields)) : [],
    });
  }
  return out.sort((a, b) => a.rollKey.localeCompare(b.rollKey, undefined, { numeric: true }));
}

function differing(fields: DecodedFields[]): number[] {
  const qs = new Set<number>();
  const all = new Set(fields.flatMap((f) => f.answers.map((a) => a.questionNumber)));
  for (const q of all) {
    const variants = new Set(fields.map((f) => JSON.stringify(f.answers.find((a) => a.questionNumber === q)?.marked ?? [])));
    if (variants.size > 1) qs.add(q);
  }
  return [...qs].sort((a, b) => a - b);
}

/**
 * Which sheets count in the gradebook:
 *   - not in a group → counts
 *   - DUPLICATE_IDENTICAL → only the earliest counts (others are silent duplicates)
 *   - DIVERGENT_ANSWERS resolved → only `keepSheetId` counts
 *   - DIVERGENT_ANSWERS unresolved → all count but are flagged SYNC_CONFLICT (held for review)
 */
export function sheetDisposition(groups: readonly ConflictGroup[]): Map<string, "counts" | "duplicate" | "superseded" | "conflict"> {
  const m = new Map<string, "counts" | "duplicate" | "superseded" | "conflict">();
  for (const g of groups) {
    if (g.kind === "DUPLICATE_IDENTICAL") g.sheetIds.forEach((id, i) => m.set(id, i === 0 ? "counts" : "duplicate"));
    else if (g.resolution) g.sheetIds.forEach((id) => m.set(id, id === g.resolution!.keepSheetId ? "counts" : "superseded"));
    else g.sheetIds.forEach((id) => m.set(id, "conflict"));
  }
  return m;
}
