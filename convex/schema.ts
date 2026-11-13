/**
 * Convex data model for the OMR Grade Engine.
 *
 * Tenancy: every exam, template and roster belongs to an org; access is checked through
 * `memberships` (owner > admin > teacher > viewer). Raw scanner output (`scans`) and teacher
 * corrections (`overrides`) are append-only; answer keys are immutable versions.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { adminAuditKind, answerKeyBody, compactReadouts, decodedFields, examPeriod, gradingFormula, originalState, overriddenOption, overrideTarget, role, student, syllabusBody } from "./validators";

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
  }).index("by_name", ["name"]),

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

  /** Course syllabi dropped by faculty; one per (school, course, term), re-dropping updates it. */
  syllabi: defineTable({
    orgId: v.id("orgs"),
    ...syllabusBody,
    uploadedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_org", ["orgId"]).index("by_org_course", ["orgId", "courseCode", "term"]),

  /** Admin-governed institutional policy (one document per school). */
  orgPolicies: defineTable({
    orgId: v.id("orgs"),
    /** extra sign-in restriction on top of the deployment allowlist; empty = deployment default only */
    allowedDomains: v.array(v.string()),
    gradingFormula,
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  /** Faculty emails approved in advance by an admin; consumed (bound to the role) when that person signs in. */
  preAuthorizations: defineTable({
    orgId: v.id("orgs"),
    email: v.string(),
    role: v.union(v.literal("teacher"), v.literal("admin")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]).index("by_org_email", ["orgId", "email"]).index("by_email", ["email"]),

  /** "Request Faculty Access" queue: signed-in accounts that are not (yet) members. */
  accessRequests: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    email: v.string(),
    name: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    requestedAt: v.number(),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
  }).index("by_org_status", ["orgId", "status"]).index("by_org_user", ["orgId", "userId"]),

  /** Admin-visible events that have no table of their own (roles, policy, syllabi). Append-only. */
  auditEvents: defineTable({
    orgId: v.id("orgs"),
    kind: adminAuditKind,
    actorId: v.id("users"),
    summary: v.string(),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_org", ["orgId", "at"]),

  /** Sliding-window rate limiting (convex/lib/rateLimit.ts). `key` is the verified token identifier. */
  rateEvents: defineTable({
    key: v.string(),
    bucket: v.string(),
    at: v.number(),
  }).index("by_key_bucket", ["key", "bucket", "at"]),

  rosters: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    importedAt: v.number(),
    students: v.array(student),
    createdBy: v.id("users"),
  }).index("by_org", ["orgId"]),

  examFolders: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    semester: v.string(),
    schoolYear: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
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
    /** course syllabus this exam assesses (outcome attainment is measured against it) */
    syllabusId: v.optional(v.id("syllabi")),
    examPeriod: v.optional(examPeriod),
    folderId: v.optional(v.id("examFolders")),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    createdBy: v.id("users"),
  }).index("by_org", ["orgId"]).index("by_org_hash", ["orgId", "layoutHash"]).index("by_folder", ["orgId", "folderId"]),

  answerKeys: defineTable({
    examId: v.id("exams"),
    version: v.number(),
    ...answerKeyBody,
    createdBy: v.id("users"),
    /** idempotency key of an offline-queued save: replaying the same save never creates a second version */
    clientKeyId: v.optional(v.string()),
  }).index("by_exam_version", ["examId", "version"]).index("by_exam_client", ["examId", "clientKeyId"]),

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
    /** idempotency key of an offline-queued resolution */
    clientId: v.optional(v.string()),
  }).index("by_exam", ["examId"]).index("by_exam_client", ["examId", "clientId"]),

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
