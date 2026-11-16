/**
 * Fast Review Queue helpers (pure) for ReviewModal:
 * flagged-sheet ordering, 1-based queue position, auto-jump target, and input-focus guard.
 */
import { needsReview, type SummarySheet } from "@/lib/grading/grade-summary";

export interface QueuePosition {
  position: number | null;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

export function flaggedQueue(sheets: readonly SummarySheet[]): string[] {
  return sheets.filter(needsReview).map((s) => s.sheetId);
}

export function queuePosition(queue: readonly string[], currentId: string): QueuePosition {
  const total = queue.length;
  const idx = queue.indexOf(currentId);
  if (idx === -1) {
    return { position: null, total, prevId: null, nextId: queue[0] ?? null };
  }
  return {
    position: idx + 1,
    total,
    prevId: idx > 0 ? queue[idx - 1] : null,
    nextId: idx < total - 1 ? queue[idx + 1] : null,
  };
}

export function firstUncertainQuestion(items: readonly { printedNumber: number; status: string }[]): number | null {
  return items.find((i) => i.status === "FLAGGED_CONFLICT")?.printedNumber ?? null;
}

export function isEditableInputTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}
