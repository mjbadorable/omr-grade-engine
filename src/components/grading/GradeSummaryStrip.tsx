"use client";
/** Compact strip above the gradebook: Students, Graded, Needs Review, Class Average (all from the scored sheets). */
import { gradeSummary, type SummarySheet } from "@/lib/grading/grade-summary";

export default function GradeSummaryStrip({ sheets }: { sheets: readonly SummarySheet[] }) {
  const s = gradeSummary(sheets);
  const tiles: { id: string; label: string; value: string; warn?: boolean }[] = [
    { id: "students", label: "Students", value: String(s.students) },
    { id: "graded", label: "Graded", value: String(s.graded) },
    { id: "needs-review", label: "Needs Review", value: String(s.needsReview), warn: s.needsReview > 0 },
    { id: "average", label: "Class Average", value: s.classAverage === null ? "–" : `${s.classAverage.toFixed(1)}%` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="grade-summary">
      {tiles.map((t) => (
        <div key={t.id} className={`v-panel px-3 py-2 ${t.warn ? "!border-gold bg-gold-tint" : ""}`} data-testid={`summary-${t.id}`}>
          <dt className="text-xs font-medium text-zinc-500">{t.label}</dt>
          <dd className="text-xl font-bold tabular-nums">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
