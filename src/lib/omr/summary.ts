/** Plain-language one-line status of the sheet being designed (no bubble counts, marks or hashes). */
export interface SheetSummary { tone: "ok" | "warn" | "error"; text: string }

export function sheetSummary(i: { questions: number; pages: number; paper: "A4" | "LETTER"; layoutErrors: number }): SheetSummary {
  const q = `${i.questions} Question${i.questions === 1 ? "" : "s"}`;
  if (i.layoutErrors > 0) return { tone: "error", text: "Layout doesn't fit — reduce questions or add columns" };
  if (i.pages > 1) return { tone: "warn", text: `${i.pages} Pages — Reduce questions or add columns to fit 1 page` };
  return { tone: "ok", text: `✓ ${q} · 1 Page (${i.paper === "A4" ? "A4" : "Letter"}) · Ready to Print` };
}
