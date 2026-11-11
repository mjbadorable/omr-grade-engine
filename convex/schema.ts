/**
 * Convex data model for the OMR Grade Engine.
 *
 * Tenancy: every exam, template and roster belongs to an org; access is checked through
 * `memberships` (owner > admin > teacher > viewer). Raw scanner output (`scans`) and teacher
 * corrections (`overrides`) are append-only; answer keys are immutable versions.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { answerKeyBody, compactReadouts, decodedFields, originalState, overriddenOption, overrideTarget, role, student } from "./validators";

export default defineSchema({
  users: defineTable({
    /** `identity.tokenIdentifier` from the auth provider (Clerk or Convex Auth) */
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  }).index("by_token", ["tokenIdentifier"]).index("by_email", ["email"]),

  orgs: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
  }),

  memberships: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role,
  }).index("by_user", ["userId"]).index("by_org_user", ["orgId", "userId"]),

  templates: defineTable({
    orgId: v.id("orgs"),
    /** OMRTemplate.templateId / version / layoutHash, denormalised for lookups */
    templateKey: v.string(),
    version: v.number(),
    layoutHash: v.string(),
    title: v.string(),
    questionCount: v.number(),
    /** full OMRTemplate (mm coordinates, fiducials, 5-row reference grid, QR); validated with OMRTemplateSchema */
    template: v.any(),
    createdBy: v.id("users"),
  }).index("by_org_hash", ["orgId", "layoutHash"]),

  rosters: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    importedAt: v.number(),
    students: v.array(student),
    createdBy: v.id("users"),
  }).index("by_org", ["orgId"]),

  exams: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    templateId: v.id("templates"),
    layoutHash: v.string(),
    rosterId: v.optional(v.id("rosters")),
    currentKeyVersion: v.number(),
    /** bumped by every change that affects grades; drives analytics recomputation */
    revision: v.number(),
    status: v.union(v.literal("draft"), v.literal("open"), v.literal("closed")),
    createdBy: v.id("users"),
  }).index("by_org", ["orgId"]).index("by_org_hash", ["orgId", "layoutHash"]),

  answerKeys: defineTable({
    examId: v.id("exams"),
    version: v.number(),
    ...answerKeyBody,
    createdBy: v.id("users"),
  }).index("by_exam_version", ["examId", "version"]),

  scans: defineTable({
    examId: v.id("exams"),
    /** client-generated id: makes submitScanBatch idempotent across retries */
    clientScanId: v.string(),
    layoutHash: v.string(),
    pageIndex: v.number(),
    studentRollNumber: v.union(v.string(), v.null()),
    /** rollKey(studentRollNumber): leading zeros and punctuation removed */
    rollKey: v.union(v.string(), v.null()),
    examSet: v.union(v.string(), v.null()),
    /** decoded fields exactly as the scanner produced them (never edited) */
    fields: decodedFields,
    rawBubbleReadouts: compactReadouts,
    /** lowest bubble confidence on the sheet */
    confidence: v.number(),
    scanTimestamp: v.number(),
    scannedByTeacherId: v.id("users"),
    deviceId: v.string(),
    previewStorageId: v.optional(v.id("_storage")),
  })
    .index("by_exam", ["examId", "scanTimestamp"])
    .index("by_exam_roll", ["examId", "rollKey"])
    .index("by_client_id", ["examId", "clientScanId"]),

  overrides: defineTable({
    examId: v.id("exams"),
    scanId: v.id("scans"),
    /** ManualOverridePatch.id (client-generated, idempotency) */
    patchId: v.string(),
    target: overrideTarget,
    questionNumber: v.number(),
    originalState,
    overriddenOption,
    reason: v.string(),
    teacherId: v.id("users"),
    /** client timestamp of the decision (ordering of patches per target) */
    timestamp: v.number(),
  }).index("by_exam", ["examId"]).index("by_scan", ["scanId"]).index("by_patch", ["examId", "patchId"]),

  conflictResolutions: defineTable({
    examId: v.id("exams"),
    rollKey: v.string(),
    keepScanId: v.id("scans"),
    supersededScanIds: v.array(v.id("scans")),
    teacherId: v.id("users"),
    timestamp: v.number(),
  }).index("by_exam", ["examId"]),

  examAnalytics: defineTable({
    examId: v.id("exams"),
    revision: v.number(),
    keyVersion: v.number(),
    scanCount: v.number(),
    gradedCount: v.number(),
    openConflicts: v.number(),
    mean: v.number(),
    sd: v.number(),
    kr20: v.union(v.number(), v.null()),
    sem: v.union(v.number(), v.null()),
    /** full PsychometricReport (item p, D, r_pbis, distractors) */
    report: v.any(),
    computedAt: v.number(),
  }).index("by_exam", ["examId"]),
});
