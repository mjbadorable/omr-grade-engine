/** Schools / institutions and teacher roles. */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fail, requireRole, requireUser } from "./lib/access";
import { role } from "./validators";

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const user = await requireUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) fail("INVALID", "School name is required.");
    const orgId = await ctx.db.insert("orgs", { name: trimmed, createdBy: user._id });
    await ctx.db.insert("memberships", { orgId, userId: user._id, role: "owner" });
    return orgId;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const ms = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const orgs = await Promise.all(ms.map(async (m) => ({ org: await ctx.db.get(m.orgId), role: m.role })));
    return orgs.filter((o) => o.org).map((o) => ({ _id: o.org!._id, name: o.org!.name, role: o.role }));
  },
});

/** Admins add an existing user (who has signed in once) by email. */
export const addMember = mutation({
  args: { orgId: v.id("orgs"), email: v.string(), role },
  handler: async (ctx, { orgId, email, role: r }) => {
    const { membership } = await requireRole(ctx, orgId, "admin");
    if (r === "owner" && membership.role !== "owner") fail("FORBIDDEN", "Only an owner can add another owner.");
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase())).first();
    if (!user) fail("NOT_FOUND", "No user with that email has signed in yet.");
    const existing = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id)).unique();
    if (existing) { await ctx.db.patch(existing._id, { role: r }); return existing._id; }
    return ctx.db.insert("memberships", { orgId, userId: user._id, role: r });
  },
});
