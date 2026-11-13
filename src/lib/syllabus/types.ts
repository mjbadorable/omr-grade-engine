/**
 * Syllabus contracts (OBE pipeline). Pure data + a Zod schema shared by the parser, the Convex
 * mutations and the UI, so there is exactly one definition of what a parsed syllabus is.
 */
import { z } from "zod";

export const EXAM_PERIODS = ["PRELIM", "MIDTERM", "FINAL"] as const;
export type ExamPeriod = (typeof EXAM_PERIODS)[number];
export const PERIOD_LABEL: Record<ExamPeriod, string> = { PRELIM: "Prelim", MIDTERM: "Midterm", FINAL: "Final Term" };

/** USA standard: Prelim = Modules 1–3, Midterm = 4–6, Final Term = 7–9. */
export const PERIOD_MODULES: Record<ExamPeriod, readonly number[]> = { PRELIM: [1, 2, 3], MIDTERM: [4, 5, 6], FINAL: [7, 8, 9] };

export function periodForModule(n: number): ExamPeriod {
  return n <= 3 ? "PRELIM" : n <= 6 ? "MIDTERM" : "FINAL";
}

/** CO attainment target (percent of possible points). */
export const ATTAINMENT_TARGET = 75;

export const ProgramOutcomeSchema = z.object({
  /** "A".."I" */
  code: z.string().regex(/^[A-Z]$/),
  description: z.string().max(4_000),
});
export const CourseOutcomeSchema = z.object({
  /** "CO1".."CO4" */
  code: z.string().regex(/^CO\d{1,2}$/),
  description: z.string().max(4_000),
  /** program outcome codes this CO supports ("A", "C" …) */
  programOutcomes: z.array(z.string().regex(/^[A-Z]$/)).max(26),
});
export const ModuleSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(300),
  topics: z.array(z.string().max(500)).max(200),
  /** CO codes covered by this module */
  courseOutcomes: z.array(z.string().max(20)).max(30),
  period: z.enum(EXAM_PERIODS),
  hours: z.number().nonnegative().optional(),
});
export const GradingComponentSchema = z.object({
  name: z.string().max(200),
  /** percent of its group (lecture / lab) */
  weight: z.number().min(0).max(100),
  group: z.enum(["lecture", "lab"]),
});
export const GradingPolicySchema = z.object({
  /** percent of the term grade, e.g. 67 */
  lectureWeight: z.number().min(0).max(100),
  labWeight: z.number().min(0).max(100),
  components: z.array(GradingComponentSchema).max(30),
  /** "syllabus" when found in the document, "default" when the USA CLASE standard was assumed */
  source: z.enum(["syllabus", "default"]),
});

export const SyllabusSchema = z.object({
  courseCode: z.string().min(1).max(40),
  courseTitle: z.string().min(1).max(300),
  term: z.string().max(60),
  programOutcomes: z.array(ProgramOutcomeSchema).max(26),
  courseOutcomes: z.array(CourseOutcomeSchema).max(30),
  modules: z.array(ModuleSchema).max(40),
  gradingPolicy: GradingPolicySchema,
});

export type ProgramOutcome = z.infer<typeof ProgramOutcomeSchema>;
export type CourseOutcome = z.infer<typeof CourseOutcomeSchema>;
export type SyllabusModule = z.infer<typeof ModuleSchema>;
export type GradingComponent = z.infer<typeof GradingComponentSchema>;
export type GradingPolicy = z.infer<typeof GradingPolicySchema>;
export type Syllabus = z.infer<typeof SyllabusSchema>;

export interface ParseResult {
  syllabus: Syllabus;
  /** things the teacher should glance at (missing sections, defaults assumed) */
  warnings: string[];
}
