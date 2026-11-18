/**
 * SyllabusBreakdown: the teacher-facing view-model of a parsed syllabus (course overview, outcomes with
 * their PO / AGA links, PRELIM / MIDTERM / FINALS terms with their modules, and each term's exam
 * coverage). Pure and derived: it works for the rich COB/COC format and degrades cleanly for older
 * syllabi that only have modules, so the UI renders one model whatever the source layout was.
 */
import { EXAM_PERIODS, PERIOD_TAB_LABEL, type ExamPeriod, type LearningOutcome, type ModuleMode, type ProgramOutcome, type Syllabus, type SyllabusModule } from "./types";

export interface BreakdownModule {
  number: number;
  /** "M0", "M1" … */
  label: string;
  title: string;
  /** orientation = no assessment (M0): gets no exam questions */
  kind: "orientation" | "assessed";
  period: ExamPeriod;
  topics: string[];
  learningOutcomes: LearningOutcome[];
  courseOutcomes: string[];
  lecture?: ModuleMode;
  lab?: ModuleMode;
  lectureHours?: number;
  labHours?: number;
  totalHours?: number;
}

export interface BreakdownExam {
  title: string;
  hours?: number;
  coverage: number[];
  /** "M1–M2" */
  coverageText: string;
  /** one segment per assessed module of the course, lit when the exam covers it */
  bar: { label: string; number: number; covered: boolean }[];
  /** true when the syllabus states no exam row and the coverage is the term's own modules */
  derived: boolean;
}

export interface BreakdownTerm {
  period: ExamPeriod;
  /** PRELIM / MIDTERM / FINALS */
  label: string;
  modules: BreakdownModule[];
  moduleCount: number;
  assessedCount: number;
  examCount: number;
  /** "3 modules · 2 assessed modules · 1 exam" */
  summary: string;
  exam?: BreakdownExam;
}

export interface SyllabusBreakdown {
  overview: { title: string; code: string; term: string; college?: string; department?: string; program?: string; courseLevel?: string; creditUnits?: string };
  programOutcomes: { total: number; codes: string[]; items: ProgramOutcome[] };
  graduateAttributes: ProgramOutcome[];
  courseOutcomes: { code: string; description: string; programOutcomes: string[]; agaLinks: string[] }[];
  terms: BreakdownTerm[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** [1,2,3,4] → "M1–M4"; [1,2,4] → "M1–M2, M4" */
export function coverageLabel(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? `M${a}` : `M${a}–M${b}`)).join(", ");
}

const isAssessed = (m: SyllabusModule) => m.assessed !== false;

function breakdownModule(m: SyllabusModule): BreakdownModule {
  const lectureHours = m.lecture?.hours;
  const labHours = m.lab?.hours;
  const split = lectureHours !== undefined || labHours !== undefined;
  return {
    number: m.number,
    label: `M${m.number}`,
    title: m.title,
    kind: isAssessed(m) ? "assessed" : "orientation",
    period: m.period,
    topics: m.topics,
    learningOutcomes: m.learningOutcomes ?? [],
    courseOutcomes: m.courseOutcomes,
    ...(m.lecture ? { lecture: m.lecture } : {}),
    ...(m.lab ? { lab: m.lab } : {}),
    ...(lectureHours !== undefined ? { lectureHours } : {}),
    ...(labHours !== undefined ? { labHours } : {}),
    ...(split ? { totalHours: (lectureHours ?? 0) + (labHours ?? 0) } : m.hours !== undefined ? { totalHours: m.hours } : {}),
  };
}

export function buildBreakdown(s: Syllabus): SyllabusBreakdown {
  const assessedNumbers = s.modules.filter(isAssessed).map((m) => m.number).sort((a, b) => a - b);
  const terms: BreakdownTerm[] = EXAM_PERIODS.map((period) => {
    const modules = s.modules.filter((m) => m.period === period).sort((a, b) => a.number - b.number).map(breakdownModule);
    const assessed = modules.filter((m) => m.kind === "assessed");
    const stated = s.exams?.find((e) => e.period === period);
    const coverage = stated?.coverage.length ? [...stated.coverage].sort((a, b) => a - b) : assessed.map((m) => m.number);
    const hasExam = !!stated || assessed.length > 0;
    const exam: BreakdownExam | undefined = hasExam ? {
      title: stated?.title ?? `${PERIOD_TAB_LABEL[period]} Examination`,
      ...(stated?.hours !== undefined ? { hours: stated.hours } : {}),
      coverage,
      coverageText: coverageLabel(coverage),
      bar: assessedNumbers.map((n) => ({ label: `M${n}`, number: n, covered: coverage.includes(n) })),
      derived: !stated?.coverage.length,
    } : undefined;
    const examCount = hasExam ? 1 : 0;
    return {
      period, label: PERIOD_TAB_LABEL[period], modules,
      moduleCount: modules.length, assessedCount: assessed.length, examCount,
      summary: [plural(modules.length, "module"), `${plural(assessed.length, "assessed module")}`, plural(examCount, "exam")].join(" · "),
      ...(exam ? { exam } : {}),
    };
  });

  const o = s.overview;
  return {
    overview: {
      title: s.courseTitle, code: s.courseCode, term: s.term,
      ...(o?.college ? { college: o.college } : {}),
      ...(o?.department ? { department: o.department } : {}),
      ...(o?.program ? { program: o.program } : {}),
      ...(o?.courseLevel ? { courseLevel: o.courseLevel } : {}),
      ...(o?.creditUnits ? { creditUnits: o.creditUnits } : {}),
    },
    programOutcomes: { total: s.programOutcomes.length, codes: s.programOutcomes.map((p) => p.code), items: s.programOutcomes },
    graduateAttributes: s.graduateAttributes ?? [],
    courseOutcomes: s.courseOutcomes.map((c) => ({ code: c.code, description: c.description, programOutcomes: c.programOutcomes, agaLinks: c.agaLinks ?? [] })),
    terms,
  };
}
