/**
 * Institution-wide grading formula (admin-governed). Default = University of San Agustin CLASE:
 *   Term Grade = 67% Lecture + 33% Lab
 *   Lecture grade: Major Exam 50% (the rest is class standing)
 *   Lab grade    : Lab Exam 30%   (the rest is laboratory activities)
 */
import { emailDomain } from "@/lib/cloud/allowlist";

export interface GradingFormula {
  lectureWeight: number;
  labWeight: number;
  /** share of the lecture grade that is the major exam */
  lectureMajorExamWeight: number;
  /** share of the lab grade that is the lab exam */
  labExamWeight: number;
}

export const CLASE_FORMULA: GradingFormula = { lectureWeight: 67, labWeight: 33, lectureMajorExamWeight: 50, labExamWeight: 30 };

export function validateFormula(f: GradingFormula): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(f)) if (!Number.isFinite(v) || v < 0 || v > 100) errors.push(`${k} must be between 0 and 100.`);
  if (Math.abs(f.lectureWeight + f.labWeight - 100) > 1e-9) errors.push("Lecture and lab weights must add up to 100%.");
  return errors;
}

/** Term grade (0–100 scale) from a lecture grade and a lab grade, both 0–100. */
export function termGrade(lecture: number, lab: number, f: GradingFormula = CLASE_FORMULA): number {
  return Math.round(((lecture * f.lectureWeight + lab * f.labWeight) / 100) * 100) / 100;
}

/** Lecture grade from major-exam % and class-standing %. */
export function lectureGrade(majorExam: number, classStanding: number, f: GradingFormula = CLASE_FORMULA): number {
  return Math.round(((majorExam * f.lectureMajorExamWeight + classStanding * (100 - f.lectureMajorExamWeight)) / 100) * 100) / 100;
}

/** Lab grade from lab-exam % and laboratory-activity %. */
export function labGrade(labExam: number, activities: number, f: GradingFormula = CLASE_FORMULA): number {
  return Math.round(((labExam * f.labExamWeight + activities * (100 - f.labExamWeight)) / 100) * 100) / 100;
}

/** Normalise an admin-entered domain list ("@USA.edu.ph, usa.edu.ph") to unique lowercase domains; invalid entries are dropped. */
export function normalizeDomains(input: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const d = raw.trim().toLowerCase().replace(/^@/, "");
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) out.add(d);
  }
  return [...out];
}

/** Exact-domain match, same rule as the sign-in allowlist. An empty policy list means "no extra restriction". */
export function emailAllowedByPolicy(email: string | null | undefined, domains: readonly string[]): boolean {
  if (!domains.length) return true;
  const d = email ? emailDomain(email) : null;
  return !!d && domains.includes(d);
}
