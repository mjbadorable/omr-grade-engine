/** Semester folders (categories) for organising examinations by term/semester. */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fail, requireRole } from "./lib/access";
import { atMost, MAX } from "./lib/limits";
import { rateLimit } from "./lib/rateLimit";

export const listByOrg = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "viewer");
    const folders = await ctx.db.query("examFolders").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").collect();
    return folders.map((f) => ({
      _id: f._id,
      name: f.name,
      semester: f.semester,
      schoolYear: f.schoolYear ?? null,
      createdAt: f.createdAt,
    }));
  },
});

export const create = mutation({
  args: {
    orgId: v.id("orgs"),
    name: v.string(),
    semester: v.string(),
    schoolYear: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, name, semester, schoolYear }) => {
    const { user } = await requireRole(ctx, orgId, "teacher");
    const trimmedName = name.trim();
    const trimmedSemester = semester.trim();
    const trimmedYear = schoolYear?.trim();
    if (!trimmedName) fail("INVALID_INPUT", "Folder name is required.");
    if (!trimmedSemester) fail("INVALID_INPUT", "Semester is required.");
    atMost("Folder name", trimmedName, MAX.name);
    atMost("Semester", trimmedSemester, 80);
    if (trimmedYear) atMost("School year", trimmedYear, 40);
    await rateLimit(ctx, user.tokenIdentifier, "examFolders.create");

    const existing = await ctx.db.query("examFolders").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    if (existing.some((f) => f.name.toLowerCase() === trimmedName.toLowerCase())) {
      fail("DUPLICATE", "A folder with this name already exists.");
    }

    return await ctx.db.insert("examFolders", {
      orgId,
      name: trimmedName,
      semester: trimmedSemester,
      ...(trimmedYear ? { schoolYear: trimmedYear } : {}),
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: { folderId: v.id("examFolders"), name: v.string() },
  handler: async (ctx, { folderId, name }) => {
    const folder = await ctx.db.get(folderId);
    if (!folder) fail("NOT_FOUND", "Folder not found.");
    await requireRole(ctx, folder.orgId, "teacher");
    const trimmed = name.trim();
    if (!trimmed) fail("INVALID_INPUT", "Folder name is required.");
    atMost("Folder name", trimmed, MAX.name);
    await ctx.db.patch(folderId, { name: trimmed });
  },
});

export const remove = mutation({
  args: { folderId: v.id("examFolders") },
  handler: async (ctx, { folderId }) => {
    const folder = await ctx.db.get(folderId);
    if (!folder) fail("NOT_FOUND", "Folder not found.");
    await requireRole(ctx, folder.orgId, "teacher");
    const linked = await ctx.db
      .query("exams")
      .withIndex("by_folder", (q) => q.eq("orgId", folder.orgId).eq("folderId", folderId))
      .collect();
    for (const exam of linked) {
      await ctx.db.patch(exam._id, { folderId: undefined });
    }
    await ctx.db.delete(folderId);
  },
});

