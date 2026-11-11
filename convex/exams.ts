/** Exams, their sheet templates and roster linkage. */
import { v } from "convex/values";
import { type AnswerKeyBody, answerKeyToBody, bodyToAnswerKey } from "../src/lib/cloud/convert";
import { keyFromTemplate } from "../src/lib/grading/answer-key";
import { OMRTemplateSchema } from "../src/lib/omr/schema";
import { RosterSchema } from "../src/lib/roster/schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { fail, requireExam, requireRole } from "./lib/access";
import { examPeriod, questionOutcome } from "./validators";
import type { QuestionOutcome } from "../src/lib/syllabus/tos";
import { applyOutcomesToKey } from "../src/lib/syllabus/tos";

async function checkSyllabus(ctx: MutationCtx, orgId: Id<"orgs">, syllabusId: Id<"syllabi">) {
  const syl = await ctx.db.get(syllabusId);
  if (!syl || syl.orgId !== orgId) fail("NOT_FOUND", "Syllabus not found in this school.");
  return syl;
}

/**
 * Create an exam from a designer template. The template is stored once per (org, layoutHash);
 * the exam starts with a blank answer key (version 1) derived from the template.
 */
export const create = mutation({
  args: {
    orgId: v.id("orgs"), name: v.string(), template: v.any(),
    /** OBE binding from the syllabus drop: syllabus, term, and the TOS question→outcome map */
    syllabusId: v.optional(v.id("syllabi")), examPeriod: v.optional(examPeriod), questionOutcomes: v.optional(v.array(questionOutcome)),
  },
  handler: async (ctx, { orgId, name, template, syllabusId, examPeriod: period, questionOutcomes }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
    if (syllabusId) await checkSyllabus(ctx, orgId, syllabusId);
    const parsed = OMRTemplateSchema.safeParse(template);
    if (!parsed.success) fail("INVALID_TEMPLATE", parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const t = parsed.data;
    let tpl = await ctx.db.query("templates").withIndex("by_org_hash", (q) => q.eq("orgId", orgId).eq("layoutHash", t.layoutHash)).first();
    const templateId = tpl?._id ?? await ctx.db.insert("templates", {
      orgId, templateKey: t.templateId, version: t.version, layoutHash: t.layoutHash, title: t.title, questionCount: t.questionCount, template: t, createdBy: user._id,
    });
    tpl ??= await ctx.db.get(templateId);
    const examId = await ctx.db.insert("exams", {
      orgId, name: name.trim() || t.title, templateId, layoutHash: t.layoutHash, currentKeyVersion: 1, revision: 1, status: "open", createdBy: user._id,
      ...(syllabusId ? { syllabusId } : {}), ...(period ? { examPeriod: period } : {}),
    });
    let key = keyFromTemplate(t, examId);
    if (questionOutcomes?.length) {
      const valid = questionOutcomes.filter((o) => key.questions.has(o.questionNumber));
      key = { ...applyOutcomesToKey(key, valid as QuestionOutcome[]), version: 1 };
    }
    await ctx.db.insert("answerKeys", { examId, version: 1, ...answerKeyToBody(key), createdBy: user._id });
    return examId;
  },
});

export const listByOrg = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "viewer");
    const exams = await ctx.db.query("exams").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").collect();
    return exams.map((e) => ({ _id: e._id, name: e.name, layoutHash: e.layoutHash, status: e.status, currentKeyVersion: e.currentKeyVersion, createdAt: e._creationTime, syllabusId: e.syllabusId ?? null, examPeriod: e.examPeriod ?? null }));
  },
});

/** Exam + its template (the scanner and gradebook need the full coordinate map). */
export const get = query({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    const { exam, membership } = await requireExam(ctx, examId, "viewer");
    const tpl = await ctx.db.get(exam.templateId);
    return { exam, template: tpl?.template ?? null, role: membership.role };
  },
});

export const setStatus = mutation({
  args: { examId: v.id("exams"), status: v.union(v.literal("draft"), v.literal("open"), v.literal("closed")) },
  handler: async (ctx, { examId, status }) => {
    await requireExam(ctx, examId, "admin");
    await ctx.db.patch(examId, { status });
  },
});

/** Import a roster (validated with RosterSchema) and link it to the exam. */
export const setRoster = mutation({
  args: { examId: v.id("exams"), roster: v.any() },
  handler: async (ctx, { examId, roster }) => {
    const { exam, user } = await requireExam(ctx, examId, "teacher");
    const parsed = RosterSchema.safeParse(roster);
    if (!parsed.success) fail("INVALID_ROSTER", parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const r = parsed.data;
    const rosterId = await ctx.db.insert("rosters", { orgId: exam.orgId, name: r.name, importedAt: r.importedAt, students: r.students, createdBy: user._id });
    await ctx.db.patch(examId, { rosterId });
    return rosterId;
  },
});

export const getRoster = query({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    const { exam } = await requireExam(ctx, examId, "viewer");
    if (!exam.rosterId) return null;
    const r = await ctx.db.get(exam.rosterId);
    return r ? { schema: "omr-roster/v1" as const, name: r.name, importedAt: r.importedAt, students: r.students } : null;
  },
});

/**
 * Bind (or re-bind) an existing exam to a syllabus: stamps the TOS outcome codes onto the key as a
 * new immutable key version (so the change is auditable) and records the exam period.
 */
export const bindSyllabus = mutation({
  args: { examId: v.id("exams"), syllabusId: v.id("syllabi"), examPeriod, questionOutcomes: v.array(questionOutcome) },
  handler: async (ctx, { examId, syllabusId, examPeriod: period, questionOutcomes }) => {
    const { exam, user } = await requireExam(ctx, examId, "teacher");
    await checkSyllabus(ctx, exam.orgId, syllabusId);
    const cur = await ctx.db.query("answerKeys").withIndex("by_exam_version", (q) => q.eq("examId", examId).eq("version", exam.currentKeyVersion)).unique();
    if (!cur) fail("NOT_FOUND", "Answer key not found.");
    const { _id, _creationTime, createdBy, examId: _e, version, ...body } = cur;
    void _id; void _creationTime; void createdBy; void _e;
    const base = bodyToAnswerKey(body as AnswerKeyBody, { examId, version });
    const next = applyOutcomesToKey(base, questionOutcomes.filter((o) => base.questions.has(o.questionNumber)) as QuestionOutcome[]);
    await ctx.db.insert("answerKeys", { examId, version: next.version, ...answerKeyToBody(next), createdBy: user._id });
    await ctx.db.patch(examId, { syllabusId, examPeriod: period, currentKeyVersion: next.version, revision: exam.revision + 1 });
    await ctx.scheduler.runAfter(1500, internal.analytics.recompute, { examId });
    return { version: next.version };
  },
});
