/**
 * Syllabus contracts (OBE pipeline). Pure data + a Zod schema shared by the parser, the Convex
 * mutations and the UI, so there is exactly one definition of what a parsed syllabus is.
 */
import { z } from "zod";

export const EXAM_PERIODS = ["PRELIM", "MIDTERM", "FINAL"] as const;
export type ExamPeriod = (typeof EXAM_PERIODS)[number];
export const PERIOD_LABEL: Record<ExamPeriod, string> = { PRELIM: "Prelim", MIDTERM: "Midterm", FINAL: "Final Term" };
/** Tab / heading wording used in the syllabus itself. The stored period value stays "FINAL" (Convex compatibility). */
export const PERIOD_TAB_LABEL: Record<ExamPeriod, string> = { PRELIM: "PRELIM", MIDTERM: "MIDTERM", FINAL: "FINALS" };

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
  /** Augustinian graduate attribute codes this CO supports ("A".."C"), when the syllabus has an AGA column */
  agaLinks: z.array(z.string().regex(/^[A-Z]$/)).max(26).optional(),
});
export const LearningOutcomeSchema = z.object({
  /** "LO 1.1" */
  code: z.string().max(20),
  description: z.string().max(500),
});
/** One teaching mode of a module (lecture or laboratory): activities, assessment tasks and contact hours. */
export const ModeSchema = z.object({
  /** teaching and learning activities */
  tla: z.array(z.string().max(200)).max(20),
  assessments: z.array(z.string().max(200)).max(20),
  hours: z.number().nonnegative().max(1_000).optional(),
});
export const ModuleSchema = z.object({
  /** 0 is the orientation module (M0) of the COB/COC template */
  number: z.number().int().nonnegative(),
  title: z.string().max(300),
  topics: z.array(z.string().max(500)).max(200),
  /** CO codes covered by this module */
  courseOutcomes: z.array(z.string().max(20)).max(30),
  period: z.enum(EXAM_PERIODS),
  /** total contact hours (lecture + laboratory) */
  hours: z.number().nonnegative().optional(),
  /** false for orientation modules that carry no assessment (they get no exam questions); absent means assessed */
  assessed: z.boolean().optional(),
  learningOutcomes: z.array(LearningOutcomeSchema).max(40).optional(),
  lecture: ModeSchema.optional(),
  lab: ModeSchema.optional(),
});
/** Course facts from the syllabus's specification table. Every field is optional: older syllabi have none. */
export const OverviewSchema = z.object({
  college: z.string().max(120).optional(),
  department: z.string().max(120).optional(),
  program: z.string().max(60).optional(),
  courseLevel: z.string().max(60).optional(),
  creditUnits: z.string().max(80).optional(),
});
/** A term examination row: which modules it covers (cumulative in the COB template) and its length. */
export const ExamSchema = z.object({
  period: z.enum(EXAM_PERIODS),
  title: z.string().max(100),
  hours: z.number().nonnegative().max(1_000).optional(),
  coverage: z.array(z.number().int().nonnegative()).max(40),
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

/** Hard ceiling on the serialized syllabus so it always fits a Convex document (1 MB) with headroom. */
export const MAX_SYLLABUS_BYTES = 600_000;

export const SyllabusSchema = z.object({
  courseCode: z.string().min(1).max(40),
  courseTitle: z.string().min(1).max(300),
  term: z.string().max(60),
  programOutcomes: z.array(ProgramOutcomeSchema).max(26),
  courseOutcomes: z.array(CourseOutcomeSchema).max(30),
  modules: z.array(ModuleSchema).max(40),
  gradingPolicy: GradingPolicySchema,
  overview: OverviewSchema.optional(),
  /** Augustinian graduate attributes (A, B, C …), same shape as a program outcome */
  graduateAttributes: z.array(ProgramOutcomeSchema).max(26).optional(),
  exams: z.array(ExamSchema).max(6).optional(),
}).refine((s) => JSON.stringify(s).length <= MAX_SYLLABUS_BYTES, { message: "Syllabus is too large." });

export type ProgramOutcome = z.infer<typeof ProgramOutcomeSchema>;
export type CourseOutcome = z.infer<typeof CourseOutcomeSchema>;
export type LearningOutcome = z.infer<typeof LearningOutcomeSchema>;
export type ModuleMode = z.infer<typeof ModeSchema>;
export type SyllabusOverview = z.infer<typeof OverviewSchema>;
export type SyllabusExam = z.infer<typeof ExamSchema>;
export type SyllabusModule = z.infer<typeof ModuleSchema>;
export type GradingComponent = z.infer<typeof GradingComponentSchema>;
export type GradingPolicy = z.infer<typeof GradingPolicySchema>;
export type Syllabus = z.infer<typeof SyllabusSchema>;

export interface ParseResult {
  syllabus: Syllabus;
  /** things the teacher should glance at (missing sections, defaults assumed) */
  warnings: string[];
}
