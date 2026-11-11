/** Exams, their sheet templates and roster linkage. */
import { v } from "convex/values";
import { answerKeyToBody } from "../src/lib/cloud/convert";
import { keyFromTemplate } from "../src/lib/grading/answer-key";
import { OMRTemplateSchema } from "../src/lib/omr/schema";
import { RosterSchema } from "../src/lib/roster/schema";
import { mutation, query } from "./_generated/server";
import { fail, requireExam, requireRole } from "./lib/access";

/**
 * Create an exam from a designer template. The template is stored once per (org, layoutHash);
 * the exam starts with a blank answer key (version 1) derived from the template.
 */
export const create = mutation({
  args: { orgId: v.id("orgs"), name: v.string(), template: v.any() },
  handler: async (ctx, { orgId, name, template }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
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
    });
    const key = keyFromTemplate(t, examId);
    await ctx.db.insert("answerKeys", { examId, version: 1, ...answerKeyToBody(key), createdBy: user._id });
    return examId;
  },
});

export const listByOrg = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "viewer");
    const exams = await ctx.db.query("exams").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").collect();
    return exams.map((e) => ({ _id: e._id, name: e.name, layoutHash: e.layoutHash, status: e.status, currentKeyVersion: e.currentKeyVersion, createdAt: e._creationTime }));
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
