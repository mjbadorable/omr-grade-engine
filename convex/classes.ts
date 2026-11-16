/**
 * Reusable classes / sections: a named student list a teacher saves once and attaches to any exam.
 * Private to the teacher who saved it (student names and contacts are personal data). A school admin
 * can remove a class but not read it. Attaching copies the students into the exam's roster through the
 * existing `exams.setRoster`, so per-exam roster linkage is unchanged.
 */
import { v } from "convex/values";
import { MAX_CLASSES, MAX_SECTION, MAX_STUDENTS, MAX_NAME, validateClassInput } from "../src/lib/classes/classes";
import { atLeast } from "../src/lib/roles/policy";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, requireRole, requireUser } from "./lib/access";
import { atMost, atMostCount } from "./lib/limits";
import { rateLimit } from "./lib/rateLimit";
import { student } from "./validators";

/** The caller's own class, or NOT_FOUND (never reveals that someone else's class exists). */
async function ownClass(ctx: QueryCtx | MutationCtx, classId: Id<"classes">) {
  const user = await requireUser(ctx);
  const doc = await ctx.db.get(classId);
  if (!doc || doc.createdBy !== user._id) fail("NOT_FOUND", "Class not found.");
  await requireRole(ctx, doc.orgId, "teacher");
  return { doc, user };
}

export const listMine = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
    const rows = await ctx.db.query("classes").withIndex("by_org_owner", (q) => q.eq("orgId", orgId).eq("createdBy", user._id)).collect();
    return rows
      .map((c) => ({ _id: c._id, name: c.name, section: c.section ?? null, count: c.students.length, updatedAt: c.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name) || (a.section ?? "").localeCompare(b.section ?? ""));
  },
});

export const get = query({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const { doc } = await ownClass(ctx, classId);
    return { _id: doc._id, name: doc.name, section: doc.section ?? null, students: doc.students, updatedAt: doc.updatedAt };
  },
});

export const save = mutation({
  args: {
    orgId: v.id("orgs"),
    /** omit to create; pass to update your own class */
    classId: v.optional(v.id("classes")),
    name: v.string(),
    section: v.optional(v.string()),
    students: v.array(student),
  },
  handler: async (ctx, { orgId, classId, name, section, students }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
    atMost("The class name", name, MAX_NAME);
    if (section) atMost("The section", section, MAX_SECTION);
    atMostCount("students", students.length, MAX_STUDENTS);
    const v2 = validateClassInput({ name, section, students });   // same rules the browser applies
    if (!v2.ok) fail("INVALID_CLASS", v2.error);
    const value = v2.value;

    let existing = null;
    if (classId) {
      existing = await ctx.db.get(classId);
      if (!existing || existing.orgId !== orgId || existing.createdBy !== user._id) fail("NOT_FOUND", "Class not found.");
    }
    await rateLimit(ctx, user.tokenIdentifier, "classes.save");

    const mine = await ctx.db.query("classes").withIndex("by_org_owner", (q) => q.eq("orgId", orgId).eq("createdBy", user._id)).collect();
    const key = (n: string, s?: string) => `${n.toLowerCase()}|${(s ?? "").toLowerCase()}`;
    if (mine.some((c) => c._id !== classId && key(c.name, c.section) === key(value.name, value.section))) fail("DUPLICATE", "You already have a class with this name and section.");
    if (!existing && mine.length >= MAX_CLASSES) fail("TOO_MANY", `You can keep at most ${MAX_CLASSES} classes. Remove one first.`);

    const now = Date.now();
    const body = { name: value.name, section: value.section, students: value.students, updatedAt: now };
    if (existing) { await ctx.db.patch(existing._id, body); return existing._id; }
    return ctx.db.insert("classes", { orgId, ...body, createdBy: user._id, createdAt: now });
  },
});

export const remove = mutation({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(classId);
    if (!doc) fail("NOT_FOUND", "Class not found.");
    const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", doc.orgId).eq("userId", user._id)).unique();
    const allowed = !!m && (doc.createdBy === user._id ? atLeast(m.role, "teacher") : atLeast(m.role, "admin"));
    if (!allowed) fail("NOT_FOUND", "Class not found.");
    await ctx.db.delete(classId);
  },
});
