/** Course syllabi: dropped by faculty (parsed in the browser), browsed in the admin repository. */
import { v } from "convex/values";
import { SyllabusSchema } from "../src/lib/syllabus/types";
import { mutation, query } from "./_generated/server";
import { fail, logAudit, requireRole } from "./lib/access";
import { rateLimit } from "./lib/rateLimit";
import { syllabusBody } from "./validators";

function validate(body: unknown) {
  const p = SyllabusSchema.safeParse(body);
  if (!p.success) fail("INVALID_SYLLABUS", p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const s = p.data;
  const poCodes = new Set(s.programOutcomes.map((x) => x.code));
  for (const co of s.courseOutcomes) for (const po of co.programOutcomes) if (poCodes.size && !poCodes.has(po)) fail("INVALID_SYLLABUS", `${co.code} references unknown program outcome ${po}.`);
  return s;
}

/**
 * Save a parsed syllabus. Re-dropping the same course + term updates the existing record
 * (so exams already bound to it keep working) instead of cluttering the repository.
 */
export const upsert = mutation({
  args: { orgId: v.id("orgs"), syllabus: v.object(syllabusBody) },
  handler: async (ctx, { orgId, syllabus }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
    await rateLimit(ctx, user.tokenIdentifier, "syllabi.upsert");
    const s = validate(syllabus);
    const existing = await ctx.db.query("syllabi").withIndex("by_org_course", (q) => q.eq("orgId", orgId).eq("courseCode", s.courseCode).eq("term", s.term)).first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...s, updatedAt: now });
      await logAudit(ctx, orgId, user._id, "SYLLABUS_UPLOAD", `Updated syllabus ${s.courseCode} ${s.courseTitle}`, s.term || undefined);
      return existing._id;
    }
    const id = await ctx.db.insert("syllabi", { orgId, ...s, uploadedBy: user._id, createdAt: now });
    await logAudit(ctx, orgId, user._id, "SYLLABUS_UPLOAD", `Uploaded syllabus ${s.courseCode} ${s.courseTitle}`, s.term || undefined);
    return id;
  },
});

export const listByOrg = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "viewer");
    const rows = await ctx.db.query("syllabi").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").collect();
    return Promise.all(rows.map(async (s) => {
      const uploader = await ctx.db.get(s.uploadedBy);
      return {
        _id: s._id, courseCode: s.courseCode, courseTitle: s.courseTitle, term: s.term,
        poCount: s.programOutcomes.length, coCount: s.courseOutcomes.length, moduleCount: s.modules.length,
        uploadedBy: uploader?.name ?? uploader?.email ?? "unknown", uploadedByEmail: uploader?.email ?? "", createdAt: s.createdAt, updatedAt: s.updatedAt ?? s.createdAt,
      };
    }));
  },
});

export const get = query({
  args: { syllabusId: v.id("syllabi") },
  handler: async (ctx, { syllabusId }) => {
    const s = await ctx.db.get(syllabusId);
    if (!s) return null;
    await requireRole(ctx, s.orgId, "viewer");
    const { _id, _creationTime, orgId, uploadedBy, createdAt, updatedAt, ...body } = s;
    void _id; void _creationTime; void orgId; void uploadedBy; void createdAt; void updatedAt;
    return body;
  },
});

/** Admins can retire a syllabus; exams that used it keep their stored outcome codes. */
export const remove = mutation({
  args: { syllabusId: v.id("syllabi") },
  handler: async (ctx, { syllabusId }) => {
    const s = await ctx.db.get(syllabusId);
    if (!s) fail("NOT_FOUND", "Syllabus not found.");
    const { user } = await requireRole(ctx, s.orgId, "admin");
    const used = await ctx.db.query("exams").withIndex("by_org", (q) => q.eq("orgId", s.orgId)).filter((q) => q.eq(q.field("syllabusId"), syllabusId)).first();
    if (used) fail("IN_USE", `Exam "${used.name}" still uses this syllabus.`);
    await ctx.db.delete(syllabusId);
    await logAudit(ctx, s.orgId, user._id, "SYLLABUS_DELETE", `Removed syllabus ${s.courseCode} ${s.courseTitle}`, s.term || undefined);
  },
});
