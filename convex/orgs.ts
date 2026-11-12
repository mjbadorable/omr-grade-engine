/** Schools / institutions and teacher roles. */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { emailAllowedByPolicy } from "../src/lib/admin/formula";
import { checkRoleChange } from "../src/lib/roles/policy";
import { DEFAULT_ORG_NAME } from "../src/lib/institution";
import { autoJoinRole, defaultAdminEmails, ensureDefaultAdmin, fail, logAudit, requireRole, requireUser } from "./lib/access";
import { role } from "./validators";

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const user = await requireUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) fail("INVALID", "School name is required.");
    const orgId = await ctx.db.insert("orgs", { name: trimmed, createdBy: user._id });
    await ctx.db.insert("memberships", { orgId, userId: user._id, role: "owner" });
    // bootstrap admins that already signed in join the new school too
    for (const u of await ctx.db.query("users").take(2000)) if (u._id !== user._id) await ensureDefaultAdmin(ctx, orgId, u);
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

/**
 * Single-institution workspace: find or create "University of San Agustin • Iloilo City" and make
 * sure the caller belongs to it, so faculty never pick or create a school. The caller joins with
 * the OMR_AUTO_JOIN role (default teacher; "off" = admins add people by hand). DEFAULT_ADMIN_EMAILS
 * users become admin, and the first of them to arrive owns a brand-new workspace. Idempotent.
 */
export const ensureDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    let org = await ctx.db.query("orgs").withIndex("by_name", (q) => q.eq("name", DEFAULT_ORG_NAME)).first();
    let created = false;
    if (!org) {
      const id = await ctx.db.insert("orgs", { name: DEFAULT_ORG_NAME, createdBy: user._id });
      org = (await ctx.db.get(id))!;
      created = true;
      for (const u of await ctx.db.query("users").take(2000)) if (u._id !== user._id) await ensureDefaultAdmin(ctx, id, u);
    }
    const find = () => ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", org!._id).eq("userId", user._id)).unique();
    let m = await find();
    if (!m && created && defaultAdminEmails().includes(user.email ?? "")) {
      await ctx.db.insert("memberships", { orgId: org._id, userId: user._id, role: "owner" });
      m = await find();
    }
    if (!m) { await ensureDefaultAdmin(ctx, org._id, user); m = await find(); }
    if (!m) {
      const role = autoJoinRole();
      if (role === "off") return { orgId: org._id, role: null };
      await ctx.db.insert("memberships", { orgId: org._id, userId: user._id, role });
      await logAudit(ctx, org._id, user._id, "ROLE_CHANGE", `${user.email ?? "user"} joined as ${role} (automatic institutional membership)`);
      m = await find();
    }
    return { orgId: org._id, role: m?.role ?? null };
  },
});
