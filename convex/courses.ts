/**
 * Courses and their sections. A course is private to the teacher who made it (like saved classes); a section
 * is a name that may point at one of that teacher's saved classes, so student lists live only in `classes`.
 * Exams are filed under a course in `exams.create`. The rules are shared with the on-device library
 * (src/lib/courses/courses.ts), so both modes behave identically.
 */
import { v } from "convex/values";
import {
  addSection as addSectionRule, createCourse, duplicateError, findDuplicateCourse, MAX_CODE, MAX_COURSES, MAX_SECTION_NAME, MAX_SECTIONS, MAX_TERM, MAX_TITLE,
  removeSection as removeSectionRule, setSectionClass as setSectionClassRule, updateCourse, validateCourseFields, type SavedCourse,
} from "../src/lib/courses/courses";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, requireRole, requireUser } from "./lib/access";
import { atMost, atMostCount } from "./lib/limits";
import { rateLimit } from "./lib/rateLimit";

const newId = () => crypto.randomUUID().slice(0, 12);

/** The caller's own course, or NOT_FOUND (never reveals that someone else's course exists). */
async function ownCourse(ctx: QueryCtx | MutationCtx, courseId: Id<"courses">) {
  const user = await requireUser(ctx);
  const doc = await ctx.db.get(courseId);
  if (!doc || doc.createdBy !== user._id) fail("NOT_FOUND", "Course not found.");
  await requireRole(ctx, doc.orgId, "teacher");
  return { doc, user };
}

/** The shared rules work on plain objects; `_id` plays the id. */
const toSaved = (c: Doc<"courses">): SavedCourse => ({
  id: c._id, code: c.code, title: c.title, semester: c.semester, ...(c.schoolYear ? { schoolYear: c.schoolYear } : {}), ...(c.syllabusId ? { syllabusId: c.syllabusId } : {}),
  sections: c.sections.map((s) => ({ id: s.id, name: s.name, ...(s.classId ? { classId: s.classId } : {}) })), createdAt: c.createdAt, updatedAt: c.updatedAt,
});
const toDocSections = (s: SavedCourse) => s.sections.map((x) => ({ id: x.id, name: x.name, ...(x.classId ? { classId: x.classId as Id<"classes"> } : {}) }));

async function checkSyllabus(ctx: MutationCtx, orgId: Id<"orgs">, syllabusId: Id<"syllabi">) {
  const syl = await ctx.db.get(syllabusId);
  if (!syl || syl.orgId !== orgId) fail("NOT_FOUND", "Syllabus not found in this school.");
}

function checkText(f: { code: string; title: string; semester: string; schoolYear?: string }) {
  atMost("The course code", f.code, MAX_CODE);
  atMost("The course title", f.title, MAX_TITLE);
  atMost("The semester", f.semester, MAX_TERM);
  if (f.schoolYear) atMost("The school year", f.schoolYear, MAX_TERM);
}

export const listMine = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    // viewers may open the app, but only teachers own courses: they simply have none
    const { user } = await requireRole(ctx, orgId, "viewer");
    const rows = await ctx.db.query("courses").withIndex("by_org_owner", (q) => q.eq("orgId", orgId).eq("createdBy", user._id)).collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({
        _id: c._id, code: c.code, title: c.title, semester: c.semester, schoolYear: c.schoolYear ?? null, syllabusId: c.syllabusId ?? null,
        sections: c.sections.map((s) => ({ id: s.id, name: s.name, classId: s.classId ?? null })), updatedAt: c.updatedAt,
      }));
  },
});

export const create = mutation({
  args: {
    orgId: v.id("orgs"), code: v.string(), title: v.string(), semester: v.string(),
    schoolYear: v.optional(v.string()), syllabusId: v.optional(v.id("syllabi")),
    /** section names; ids are issued here */
    sections: v.array(v.string()),
  },
  handler: async (ctx, { orgId, sections, ...fields }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
    checkText(fields);
    atMostCount("sections", sections.length, MAX_SECTIONS);
    for (const name of sections) atMost("A section name", name, MAX_SECTION_NAME);
    await rateLimit(ctx, user.tokenIdentifier, "courses.create");
    if (fields.syllabusId) await checkSyllabus(ctx, orgId, fields.syllabusId);

    const mine = (await ctx.db.query("courses").withIndex("by_org_owner", (q) => q.eq("orgId", orgId).eq("createdBy", user._id)).collect()).map(toSaved);
    const f = validateCourseFields(fields);
    if (!f.ok) fail("INVALID_COURSE", f.error);
    const dup = findDuplicateCourse(mine, f.value);
    if (dup) fail("DUPLICATE", duplicateError(dup));
    if (mine.length >= MAX_COURSES) fail("TOO_MANY", `You can keep at most ${MAX_COURSES} courses. Remove one first.`);
    const r = createCourse(mine, { ...f.value, sections }, { now: Date.now(), newId });
    if ("error" in r) fail("INVALID_COURSE", r.error);
    const { id: _id, createdAt, updatedAt, sections: made, ...body } = r.saved;
    void _id;
    return ctx.db.insert("courses", {
      orgId, ...body, syllabusId: body.syllabusId as Id<"syllabi"> | undefined,
      sections: made.map((s) => ({ id: s.id, name: s.name })), createdBy: user._id, createdAt, updatedAt,
    });
  },
});

export const update = mutation({
  args: { courseId: v.id("courses"), code: v.string(), title: v.string(), semester: v.string(), schoolYear: v.optional(v.string()), syllabusId: v.optional(v.id("syllabi")) },
  handler: async (ctx, { courseId, ...fields }) => {
    const { doc, user } = await ownCourse(ctx, courseId);
    checkText(fields);
    await rateLimit(ctx, user.tokenIdentifier, "courses.edit");
    if (fields.syllabusId) await checkSyllabus(ctx, doc.orgId, fields.syllabusId);
    const mine = (await ctx.db.query("courses").withIndex("by_org_owner", (q) => q.eq("orgId", doc.orgId).eq("createdBy", user._id)).collect()).map(toSaved);
    const f = validateCourseFields(fields);
    if (!f.ok) fail("INVALID_COURSE", f.error);
    const dup = findDuplicateCourse(mine, f.value, courseId);
    if (dup) fail("DUPLICATE", duplicateError(dup));
    const r = updateCourse(mine, courseId, f.value, Date.now());
    if ("error" in r) fail("INVALID_COURSE", r.error);
    // `patch` keeps absent fields, so the optional ones are cleared explicitly
    await ctx.db.patch(courseId, { schoolYear: undefined, syllabusId: undefined, code: f.value.code, title: f.value.title, semester: f.value.semester, ...(f.value.schoolYear ? { schoolYear: f.value.schoolYear } : {}), ...(f.value.syllabusId ? { syllabusId: f.value.syllabusId as Id<"syllabi"> } : {}), updatedAt: r.saved.updatedAt });
  },
});

export const addSection = mutation({
  args: { courseId: v.id("courses"), name: v.string() },
  handler: async (ctx, { courseId, name }) => {
    const { doc, user } = await ownCourse(ctx, courseId);
    atMost("A section name", name, MAX_SECTION_NAME);
    await rateLimit(ctx, user.tokenIdentifier, "courses.edit");
    const r = addSectionRule([toSaved(doc)], courseId, name, { now: Date.now(), newId });
    if ("error" in r) fail("INVALID_COURSE", r.error);
    await ctx.db.patch(courseId, { sections: toDocSections(r.saved), updatedAt: r.saved.updatedAt });
  },
});

export const removeSection = mutation({
  args: { courseId: v.id("courses"), sectionId: v.string() },
  handler: async (ctx, { courseId, sectionId }) => {
    const { doc, user } = await ownCourse(ctx, courseId);
    atMost("The section id", sectionId, 100);
    await rateLimit(ctx, user.tokenIdentifier, "courses.edit");
    const scoped = (await ctx.db.query("exams").withIndex("by_course", (q) => q.eq("orgId", doc.orgId).eq("courseId", courseId)).collect()).filter((e) => e.sectionId === sectionId).length;
    const r = removeSectionRule([toSaved(doc)], courseId, sectionId, scoped, Date.now());
    if ("error" in r) fail(scoped > 0 ? "IN_USE" : "NOT_FOUND", r.error);
    await ctx.db.patch(courseId, { sections: toDocSections(r.saved), updatedAt: r.saved.updatedAt });
  },
});

/** Attach (or detach, with null) one of the caller's saved classes to a section. The roster itself is never copied. */
export const setSectionClass = mutation({
  args: { courseId: v.id("courses"), sectionId: v.string(), classId: v.union(v.id("classes"), v.null()) },
  handler: async (ctx, { courseId, sectionId, classId }) => {
    const { doc, user } = await ownCourse(ctx, courseId);
    atMost("The section id", sectionId, 100);
    if (classId) {
      const cls = await ctx.db.get(classId);
      if (!cls || cls.orgId !== doc.orgId || cls.createdBy !== user._id) fail("NOT_FOUND", "Class not found.");
    }
    await rateLimit(ctx, user.tokenIdentifier, "courses.edit");
    const r = setSectionClassRule([toSaved(doc)], courseId, sectionId, classId, Date.now());
    if ("error" in r) fail("NOT_FOUND", r.error);
    await ctx.db.patch(courseId, { sections: toDocSections(r.saved), updatedAt: r.saved.updatedAt });
  },
});

/** Removing a course keeps its exams (and every scan and grade on them); they simply become unfiled. */
export const remove = mutation({
  args: { courseId: v.id("courses") },
  handler: async (ctx, { courseId }) => {
    const { doc, user } = await ownCourse(ctx, courseId);
    await rateLimit(ctx, user.tokenIdentifier, "courses.edit");
    for (const e of await ctx.db.query("exams").withIndex("by_course", (q) => q.eq("orgId", doc.orgId).eq("courseId", courseId)).collect()) {
      await ctx.db.patch(e._id, { courseId: undefined, sectionId: undefined });
    }
    await ctx.db.delete(courseId);
  },
});
