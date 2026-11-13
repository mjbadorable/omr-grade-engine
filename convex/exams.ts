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
import { atMost, atMostCount, MAX } from "./lib/limits";
import { rateLimit } from "./lib/rateLimit";
import { examPeriod, questionOutcome } from "./validators";
import type { QuestionOutcome } from "../src/lib/syllabus/tos";
import { applyOutcomesToKey } from "../src/lib/syllabus/tos";

async function checkSyllabus(ctx: MutationCtx, orgId: Id<"orgs">, syllabusId: Id<"syllabi">) {
  const syl = await ctx.db.get(syllabusId);
  if (!syl || syl.orgId !== orgId) fail("NOT_FOUND", "Syllabus not found in this school.");
  return syl;
}

async function checkFolder(ctx: MutationCtx, orgId: Id<"orgs">, folderId: Id<"examFolders">) {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.orgId !== orgId) fail("NOT_FOUND", "Folder not found in this school.");
  return folder;
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
    folderId: v.optional(v.id("examFolders")),
  },
  handler: async (ctx, { orgId, name, template, syllabusId, examPeriod: period, questionOutcomes, folderId }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
    atMost("The exam name", name, MAX.name);
    atMostCount("question outcomes", questionOutcomes?.length ?? 0, MAX.outcomes);
    await rateLimit(ctx, user.tokenIdentifier, "exams.create");
    if (syllabusId) await checkSyllabus(ctx, orgId, syllabusId);
    if (folderId) await checkFolder(ctx, orgId, folderId);
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
      ...(syllabusId ? { syllabusId } : {}), ...(period ? { examPeriod: period } : {}), ...(folderId ? { folderId } : {}),
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
    return exams.map((e) => ({
      _id: e._id,
      name: e.name,
      layoutHash: e.layoutHash,
      status: e.status,
      currentKeyVersion: e.currentKeyVersion,
      createdAt: e._creationTime,
      syllabusId: e.syllabusId ?? null,
      examPeriod: e.examPeriod ?? null,
      folderId: e.folderId ?? null,
      archivedAt: e.archivedAt ?? null,
    }));
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
    atMostCount("question outcomes", questionOutcomes.length, MAX.outcomes);
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

/** Duplicate a set-up exam (template, latest answer key, syllabus/period, and folder) without copying student scans. */
export const duplicate = mutation({
  args: {
    examId: v.id("exams"),
    name: v.optional(v.string()),
    folderId: v.optional(v.union(v.id("examFolders"), v.null())),
  },
  handler: async (ctx, { examId, name, folderId }) => {
    const { exam, user } = await requireExam(ctx, examId, "teacher");
    await rateLimit(ctx, user.tokenIdentifier, "exams.create");
    const targetFolder = folderId === undefined ? exam.folderId : folderId ?? undefined;
    if (targetFolder) await checkFolder(ctx, exam.orgId, targetFolder);

    const copyName = (name?.trim() || `${exam.name} (Copy)`).slice(0, MAX.name);
    atMost("The exam name", copyName, MAX.name);

    const copyId = await ctx.db.insert("exams", {
      orgId: exam.orgId,
      name: copyName,
      templateId: exam.templateId,
      layoutHash: exam.layoutHash,
      currentKeyVersion: 1,
      revision: 1,
      status: "open",
      createdBy: user._id,
      ...(exam.syllabusId ? { syllabusId: exam.syllabusId } : {}),
      ...(exam.examPeriod ? { examPeriod: exam.examPeriod } : {}),
      ...(targetFolder ? { folderId: targetFolder } : {}),
    });

    const curKey = await ctx.db
      .query("answerKeys")
      .withIndex("by_exam_version", (q) => q.eq("examId", examId).eq("version", exam.currentKeyVersion))
      .unique();
    if (curKey) {
      const { _id, _creationTime, createdBy, examId: _e, version: _v, clientKeyId: _c, ...body } = curKey;
      void _id; void _creationTime; void createdBy; void _e; void _v; void _c;
      await ctx.db.insert("answerKeys", { examId: copyId, version: 1, ...(body as AnswerKeyBody), createdBy: user._id });
    } else {
      const tpl = await ctx.db.get(exam.templateId);
      const parsed = tpl ? OMRTemplateSchema.safeParse(tpl.template) : null;
      if (parsed?.success) {
        const key = keyFromTemplate(parsed.data, copyId);
        await ctx.db.insert("answerKeys", { examId: copyId, version: 1, ...answerKeyToBody(key), createdBy: user._id });
      }
    }
    return copyId;
  },
});

export const archive = mutation({
  args: { examId: v.id("exams"), archived: v.boolean() },
  handler: async (ctx, { examId, archived }) => {
    const { user } = await requireExam(ctx, examId, "teacher");
    await ctx.db.patch(examId, {
      archivedAt: archived ? Date.now() : undefined,
      archivedBy: archived ? user._id : undefined,
    });
  },
});

export const setFolder = mutation({
  args: { examId: v.id("exams"), folderId: v.union(v.id("examFolders"), v.null()) },
  handler: async (ctx, { examId, folderId }) => {
    const { exam } = await requireExam(ctx, examId, "teacher");
    if (folderId) await checkFolder(ctx, exam.orgId, folderId);
    await ctx.db.patch(examId, { folderId: folderId ?? undefined });
  },
});

export const remove = mutation({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    const { exam, user, membership } = await requireExam(ctx, examId, "teacher");
    const isAdmin = membership.role === "admin" || membership.role === "owner";
    if (!isAdmin && exam.createdBy !== user._id) {
      fail("FORBIDDEN", "Only the exam creator or an administrator can delete this exam.");
    }

    for (const key of await ctx.db.query("answerKeys").withIndex("by_exam_version", (q) => q.eq("examId", examId)).collect()) {
      await ctx.db.delete(key._id);
    }
    for (const scan of await ctx.db.query("scans").withIndex("by_exam", (q) => q.eq("examId", examId)).collect()) {
      if (scan.previewStorageId) {
        try { await ctx.storage.delete(scan.previewStorageId); } catch { /* ignore missing storage object */ }
      }
      await ctx.db.delete(scan._id);
    }
    for (const ov of await ctx.db.query("overrides").withIndex("by_exam", (q) => q.eq("examId", examId)).collect()) {
      await ctx.db.delete(ov._id);
    }
    for (const cr of await ctx.db.query("conflictResolutions").withIndex("by_exam", (q) => q.eq("examId", examId)).collect()) {
      await ctx.db.delete(cr._id);
    }
    for (const an of await ctx.db.query("examAnalytics").withIndex("by_exam", (q) => q.eq("examId", examId)).collect()) {
      await ctx.db.delete(an._id);
    }
    await ctx.db.delete(examId);
  },
});
