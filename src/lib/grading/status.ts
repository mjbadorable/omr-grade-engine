/** Educator-facing gradebook status line (no versions, timings or hashes). */
export function answerKeyStatus(i: { keyed: number; total: number; papers: number; saving?: boolean }): string {
  return `Answer Key: ${i.keyed} / ${i.total} keyed · ${i.papers} Paper${i.papers === 1 ? "" : "s"} Scanned${i.saving ? " · saving…" : ""}`;
}
