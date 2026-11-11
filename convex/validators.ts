/**
 * Convex validators mirroring the Sprint 1–4 TypeScript contracts.
 * Deep structures that already have a Zod schema (OMRTemplate, Roster) are stored as `v.any()`
 * and validated with that Zod schema inside the mutation, so there is exactly one definition.
 */
import { v } from "convex/values";

export const role = v.union(v.literal("owner"), v.literal("admin"), v.literal("teacher"), v.literal("viewer"));

// ---- answer key (src/lib/grading/types.ts)
const ruleBase = {
  questionNumber: v.number(),
  points: v.number(),
  negative: v.number(),
  bonus: v.boolean(),
  dropped: v.boolean(),
  tags: v.object({ subject: v.optional(v.string()), section: v.optional(v.string()) }),
  /** syllabus outcome ("CO1".."CO4") and module this question measures */
  outcomeCode: v.optional(v.string()),
  moduleNumber: v.optional(v.number()),
};
export const questionRule = v.union(
  v.object({ ...ruleBase, type: v.literal("choice"), optionCount: v.number(), optionLabels: v.array(v.string()), correct: v.array(v.number()), mode: v.union(v.literal("ALL_MATCH"), v.literal("ANY_MATCH"), v.literal("PARTIAL_CREDIT")) }),
  v.object({ ...ruleBase, type: v.literal("numeric"), value: v.union(v.number(), v.null()), tolerance: v.number() }),
  v.object({ ...ruleBase, type: v.literal("matrix"), rows: v.record(v.string(), v.array(v.string())), mode: v.union(v.literal("ALL_MATCH"), v.literal("PARTIAL_CREDIT")) }),
);
export const setMapping = v.object({
  questionOrder: v.optional(v.array(v.number())),
  /** master question number (as string key) → permutation */
  optionPermutations: v.optional(v.record(v.string(), v.array(v.number()))),
});
export const answerKeyBody = {
  /** master question number (as string key) → rule */
  questions: v.record(v.string(), questionRule),
  sets: v.record(v.string(), setMapping),
  defaultSet: v.union(v.string(), v.null()),
  gradeBands: v.array(v.object({ minPercent: v.number(), label: v.string() })),
  conflictPolicy: v.union(v.literal("zero"), v.literal("score-filled")),
};

// ---- decoded fields (src/lib/vision/types.ts)
export const decodedFields = v.object({
  rollNumber: v.union(v.string(), v.null()),
  rollDigits: v.array(v.union(v.string(), v.null())),
  examSet: v.union(v.string(), v.null()),
  answers: v.array(v.object({ questionNumber: v.number(), marked: v.array(v.number()), labels: v.array(v.string()), uncertain: v.boolean() })),
  numeric: v.array(v.object({ questionNumber: v.number(), value: v.union(v.string(), v.null()), uncertain: v.boolean() })),
  matrix: v.array(v.object({ questionNumber: v.number(), rows: v.record(v.string(), v.array(v.string())), uncertain: v.boolean() })),
  conflicts: v.array(v.object({ code: v.string(), field: v.string(), index: v.number(), bubbleIds: v.array(v.string()), message: v.string() })),
});

/**
 * Compact per-bubble readouts, aligned to the template's bubble order (bubbleRefs(page)):
 * one character per bubble for the state (F filled, P partial, X erasure, E empty) and
 * parallel arrays for density and confidence. ~3 KB for a 100-question sheet instead of ~70 KB.
 */
export const compactReadouts = v.object({
  states: v.string(),
  density: v.array(v.number()),
  confidence: v.array(v.number()),
});

// ---- overrides (src/lib/review/overrides.ts)
export const overrideTarget = v.union(v.literal("answer"), v.literal("roll"), v.literal("set"), v.literal("numeric"));
export const originalState = v.object({
  marked: v.optional(v.array(v.number())),
  labels: v.optional(v.array(v.string())),
  value: v.optional(v.union(v.string(), v.null())),
  uncertain: v.optional(v.boolean()),
});
export const overriddenOption = v.union(v.array(v.number()), v.string(), v.null());

export const student = v.object({
  rollNumber: v.string(),
  name: v.string(),
  section: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  guardianContact: v.optional(v.string()),
});

// ---- syllabus / OBE (src/lib/syllabus/types.ts)
export const examPeriod = v.union(v.literal("PRELIM"), v.literal("MIDTERM"), v.literal("FINAL"));
export const syllabusBody = {
  courseCode: v.string(),
  courseTitle: v.string(),
  term: v.string(),
  /** PO A–I */
  programOutcomes: v.array(v.object({ code: v.string(), description: v.string() })),
  /** CO1–CO4, each linked to the POs it supports */
  courseOutcomes: v.array(v.object({ code: v.string(), description: v.string(), programOutcomes: v.array(v.string()) })),
  modules: v.array(v.object({ number: v.number(), title: v.string(), topics: v.array(v.string()), courseOutcomes: v.array(v.string()), period: examPeriod, hours: v.optional(v.number()) })),
  gradingPolicy: v.object({
    lectureWeight: v.number(),
    labWeight: v.number(),
    components: v.array(v.object({ name: v.string(), weight: v.number(), group: v.union(v.literal("lecture"), v.literal("lab")) })),
    source: v.union(v.literal("syllabus"), v.literal("default")),
  }),
};
/** question → module / outcome produced by the Table of Specifications */
export const questionOutcome = v.object({ questionNumber: v.number(), moduleNumber: v.number(), outcomeCode: v.union(v.string(), v.null()) });

// ---- governance (src/lib/admin)
export const gradingFormula = v.object({ lectureWeight: v.number(), labWeight: v.number(), lectureMajorExamWeight: v.number(), labExamWeight: v.number() });
export const adminAuditKind = v.union(v.literal("ROLE_CHANGE"), v.literal("POLICY_CHANGE"), v.literal("SYLLABUS_UPLOAD"), v.literal("SYLLABUS_DELETE"));
