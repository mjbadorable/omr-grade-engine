/** Schools / institutions and teacher roles. */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { emailAllowedByPolicy } from "../src/lib/admin/formula";
import { checkRoleChange } from "../src/lib/roles/policy";
import { fail, logAudit, requireRole, requireUser } from "./lib/access";
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

/**
 * Admins add an existing user (who has signed in once) by email, or change their role.
 * The school's domain policy (set in /admin) narrows who may join beyond the sign-in allowlist.
 */
export const addMember = mutation({
  args: { orgId: v.id("orgs"), email: v.string(), role },
  handler: async (ctx, { orgId, email, role: r }) => {
    const { membership, user: actor } = await requireRole(ctx, orgId, "admin");
    if (r === "owner" && membership.role !== "owner") fail("FORBIDDEN", "Only an owner can add another owner.");
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase())).first();
    if (!user) fail("NOT_FOUND", "No user with that email has signed in yet.");
    const policy = await ctx.db.query("orgPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
    if (policy && !emailAllowedByPolicy(user.email, policy.allowedDomains)) fail("DOMAIN_NOT_ALLOWED", `${user.email} is outside this school's allowed domains (${policy.allowedDomains.map((d) => `@${d}`).join(", ")}).`);
    const existing = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id)).unique();
    if (existing) {
      // An owner may hand over ownership; every other change follows the directory rules.
      if (!(r === "owner" && membership.role === "owner")) {
        const d = checkRoleChange({ actor: membership.role, actorId: actor._id, target: existing.role, targetId: user._id, next: r });
        if (!d.ok) fail(d.code, d.message);
      }
      await ctx.db.patch(existing._id, { role: r });
      await logAudit(ctx, orgId, actor._id, "ROLE_CHANGE", `${user.email} role ${existing.role} → ${r}`);
      return existing._id;
    }
    await logAudit(ctx, orgId, actor._id, "ROLE_CHANGE", `${user.email} added as ${r}`);
    return ctx.db.insert("memberships", { orgId, userId: user._id, role: r });
  },
});
