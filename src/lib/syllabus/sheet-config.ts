/**
 * Auto-configure the answer-sheet designer from a dropped syllabus: title/subtitle from the
 * course and exam period, and the exam length matched to the TOS total.
 */
import type { LayoutSettings } from "@/lib/omr/schema";
import { PERIOD_LABEL, type ExamPeriod, type Syllabus } from "./types";

export const totalQuestions = (s: Pick<LayoutSettings, "sections">) => s.sections.reduce((n, x) => n + x.questionCount, 0);

export type SheetConfig = { ok: true; settings: LayoutSettings } | { ok: false; error: string };

/**
 * Returns settings whose question count equals `total`. The difference is absorbed by the first
 * multiple-choice section (the other section types have small fixed sizes).
 */
export function configureSheet(settings: LayoutSettings, syllabus: Pick<Syllabus, "courseCode" | "courseTitle" | "term">, period: ExamPeriod, total: number): SheetConfig {
  const next: LayoutSettings = {
    ...settings,
    title: `${syllabus.courseCode} ${PERIOD_LABEL[period]} Exam`.slice(0, 80),
    subtitle: [syllabus.courseTitle, syllabus.term].filter(Boolean).join(" - ").slice(0, 80),
  };
  const delta = total - totalQuestions(settings);
  if (delta === 0) return { ok: true, settings: next };
  const i = settings.sections.findIndex((x) => x.type === "mcq");
  if (i < 0) return { ok: false, error: "The sheet has no multiple-choice section to resize." };
  const sec = settings.sections[i];
  const count = sec.questionCount + delta;
  if (count < 1 || count > 200) return { ok: false, error: `A ${total}-question exam does not fit: the multiple-choice section would have ${count} questions (1–200).` };
  return { ok: true, settings: { ...next, sections: settings.sections.map((x, j) => (j === i ? { ...x, questionCount: count } : x)) } };
}
