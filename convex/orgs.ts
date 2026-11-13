/** Schools / institutions and teacher roles. */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { emailAllowedByPolicy } from "../src/lib/admin/formula";
import { checkRoleChange } from "../src/lib/roles/policy";
import { DEFAULT_ORG_NAME } from "../src/lib/institution";
import { autoJoinRole, bindPreAuthorizations, defaultAdminEmails, ensureDefaultAdmin, fail, logAudit, requireRole, requireUser } from "./lib/access";
import { atMost, MAX } from "./lib/limits";
import { rateLimit } from "./lib/rateLimit";
import { role } from "./validators";

/**
 * Backend-only: creating a school is not something browsers may do (any signed-in @usa.edu.ph
 * account, students included, could otherwise spawn schools or squat the default workspace name).
 * Run it from the Convex dashboard / `npx convex run orgs:create`, or from tests, on behalf of a user.
 */
export const create = internalMutation({
  args: { name: v.string(), createdBy: v.id("users") },
  handler: async (ctx, { name, createdBy }) => {
    const user = await ctx.db.get(createdBy);
    if (!user) fail("NOT_FOUND", "That user does not exist.");
    atMost("The school name", name, MAX.name);
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
    atMost("The email", email, MAX.email);
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
 * the OMR_AUTO_JOIN role only when it is set to teacher / viewer (default "off": students share the domain, so nobody joins without pre-authorization or approval). DEFAULT_ADMIN_EMAILS
 * users become admin, and the first of them to arrive owns a brand-new workspace. Idempotent.
 */
export const ensureDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await rateLimit(ctx, user.tokenIdentifier, "orgs.ensureDefault");
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
    if (!m) { await bindPreAuthorizations(ctx, user); m = await find(); }
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

/** Where the signed-in account stands in the workspace (drives the "Faculty Access Required" gate). */
export const myAccess = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_name", (q) => q.eq("name", DEFAULT_ORG_NAME)).first();
    if (!org) return { orgId: null, role: null, request: null as null | "pending" | "approved" | "rejected" };
    const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", user._id)).unique();
    const req = await ctx.db.query("accessRequests").withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", user._id)).unique();
    return { orgId: org._id, role: m?.role ?? null, request: req?.status ?? null };
  },
});

/** An unauthorized account asks for faculty access; admins approve or reject in /admin. Idempotent. */
export const requestAccess = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await rateLimit(ctx, user.tokenIdentifier, "orgs.requestAccess");
    const org = await ctx.db.query("orgs").withIndex("by_name", (q) => q.eq("name", DEFAULT_ORG_NAME)).first();
    if (!org) fail("NOT_FOUND", "The workspace is not ready yet. Reload and try again.");
    const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", user._id)).unique();
    if (m) return { status: "approved" as const };
    const req = await ctx.db.query("accessRequests").withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", user._id)).unique();
    const now = Date.now();
    if (req?.status === "pending") return { status: "pending" as const };
    if (req) await ctx.db.patch(req._id, { status: "pending", requestedAt: now, decidedBy: undefined, decidedAt: undefined, name: user.name, email: user.email ?? req.email });
    else await ctx.db.insert("accessRequests", { orgId: org._id, userId: user._id, email: user.email ?? "", name: user.name, status: "pending", requestedAt: now });
    return { status: "pending" as const };
  },
});
