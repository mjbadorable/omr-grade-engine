/**
 * Governance portal backend (admin role only, except `getPolicy` which any member may read so
 * teachers see the institution's grading formula).
 *   - faculty directory + role elevation (teacher ↔ admin)
 *   - domain allowlist policy and the global grading formula
 *   - searchable audit trail across every exam in the school
 */
import { v } from "convex/values";
import { AUDIT_LABEL, type AuditEntry, describeKeyChange, searchAudit } from "../src/lib/admin/audit";
import { AUDIT_KINDS } from "../src/lib/admin/audit";
import { CLASE_FORMULA, normalizeDomains, validateFormula } from "../src/lib/admin/formula";
import { checkRoleChange } from "../src/lib/roles/policy";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { emailAllowedByPolicy } from "../src/lib/admin/formula";
import { parseEmailList } from "../src/lib/access-requests";
import { allowedDomains, fail, logAudit, requireRole } from "./lib/access";
import { gradingFormula, role } from "./validators";

export const listFaculty = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "admin");
    const ms = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId)).collect();
    const rows = await Promise.all(ms.map(async (m) => {
      const u = await ctx.db.get(m.userId);
      return { userId: m.userId, name: u?.name ?? "", email: u?.email ?? "", role: m.role };
    }));
    const order = { owner: 0, admin: 1, teacher: 2, viewer: 3 } as const;
    return rows.sort((a, b) => order[a.role] - order[b.role] || (a.name || a.email).localeCompare(b.name || b.email));
  },
});

/** Elevate or demote a member (teacher ↔ admin, or to read-only). Rules live in checkRoleChange. */
export const setRole = mutation({
  args: { orgId: v.id("orgs"), userId: v.id("users"), role },
  handler: async (ctx, { orgId, userId, role: next }) => {
    const { user: actor, membership } = await requireRole(ctx, orgId, "admin");
    const target = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
    if (!target) fail("NOT_FOUND", "That person is not a member of this school.");
    const d = checkRoleChange({ actor: membership.role, actorId: actor._id, target: target.role, targetId: userId, next });
    if (!d.ok) fail(d.code, d.message);
    if (target.role === next) return;
    const u = await ctx.db.get(userId);
    await ctx.db.patch(target._id, { role: next });
    await logAudit(ctx, orgId, actor._id, "ROLE_CHANGE", `${u?.email ?? userId} role ${target.role} → ${next}`);
  },
});

export const getPolicy = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "viewer");
    const p = await ctx.db.query("orgPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
    return { allowedDomains: p?.allowedDomains ?? [], gradingFormula: p?.gradingFormula ?? CLASE_FORMULA, isDefault: !p, updatedAt: p?.updatedAt ?? null };
  },
});

export const setPolicy = mutation({
  args: { orgId: v.id("orgs"), allowedDomains: v.array(v.string()), gradingFormula },
  handler: async (ctx, { orgId, allowedDomains, gradingFormula: f }) => {
    const { user } = await requireRole(ctx, orgId, "admin");
    const errors = validateFormula(f);
    if (errors.length) fail("INVALID_FORMULA", errors.join(" "));
    const domains = normalizeDomains(allowedDomains);
    if (allowedDomains.some((d) => d.trim()) && !domains.length) fail("INVALID_DOMAIN", "No valid domain in the list (example: usa.edu.ph).");
    const cur = await ctx.db.query("orgPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
    const doc = { orgId, allowedDomains: domains, gradingFormula: f, updatedBy: user._id, updatedAt: Date.now() };
    if (cur) await ctx.db.patch(cur._id, doc); else await ctx.db.insert("orgPolicies", doc);
    await logAudit(ctx, orgId, user._id, "POLICY_CHANGE", `Grading ${f.lectureWeight}% lecture / ${f.labWeight}% lab; domains ${domains.length ? domains.map((d) => `@${d}`).join(", ") : "deployment default"}`);
  },
});

const PER_SOURCE = 400;
/** answer-key bodies are large (one rule per question), so fewer versions per exam are read */
const KEYS_PER_EXAM = 50;
const EXAMS = 100;

async function actorInfo(ctx: QueryCtx, cache: Map<Id<"users">, { name: string; email: string }>, id: Id<"users">) {
  let a = cache.get(id);
  if (!a) {
    const u = await ctx.db.get(id);
    a = { name: u?.name ?? u?.email ?? "unknown", email: u?.email ?? "" };
    cache.set(id, a);
  }
  return a;
}

/**
 * Every manual answer-key update, grade override, conflict resolution and admin event in the
 * school, newest first, filtered server-side so the browser receives a bounded page.
 */
export const auditTrail = query({
  args: { orgId: v.id("orgs"), query: v.optional(v.string()), kinds: v.optional(v.array(v.string())), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, query: text, kinds, limit }) => {
    await requireRole(ctx, orgId, "admin");
    const cache = new Map<Id<"users">, { name: string; email: string }>();
    const entries: AuditEntry[] = [];
    const exams = await ctx.db.query("exams").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(EXAMS);

    for (const exam of exams) {
      const keys = await ctx.db.query("answerKeys").withIndex("by_exam_version", (q) => q.eq("examId", exam._id)).order("desc").take(KEYS_PER_EXAM);
      const byVersion = new Map(keys.map((k) => [k.version, k]));
      for (const k of keys) {
        if (k.version === 1) continue;                       // v1 is the blank key made with the exam
        const a = await actorInfo(ctx, cache, k.createdBy);
        entries.push({ id: `key:${k._id}`, at: k._creationTime, kind: "KEY_UPDATE", actorId: k.createdBy, actorName: a.name, actorEmail: a.email, examName: exam.name, summary: `Answer key v${k.version}: ${describeKeyChange(byVersion.get(k.version - 1) ?? null, k as unknown as Parameters<typeof describeKeyChange>[1])}` });
      }
      const ovs: Doc<"overrides">[] = await ctx.db.query("overrides").withIndex("by_exam", (q) => q.eq("examId", exam._id)).order("desc").take(PER_SOURCE);
      for (const o of ovs) {
        const a = await actorInfo(ctx, cache, o.teacherId);
        entries.push({ id: `ov:${o._id}`, at: o.timestamp, kind: "GRADE_OVERRIDE", actorId: o.teacherId, actorName: a.name, actorEmail: a.email, examName: exam.name, summary: `Q${o.questionNumber} (${o.target}) corrected on a scanned sheet`, detail: `reason: ${o.reason}` });
      }
      const rs = await ctx.db.query("conflictResolutions").withIndex("by_exam", (q) => q.eq("examId", exam._id)).order("desc").take(PER_SOURCE);
      for (const r of rs) {
        const a = await actorInfo(ctx, cache, r.teacherId);
        entries.push({ id: `cr:${r._id}`, at: r.timestamp, kind: "CONFLICT_RESOLUTION", actorId: r.teacherId, actorName: a.name, actorEmail: a.email, examName: exam.name, summary: `Duplicate roll ${r.rollKey}: kept one sheet, set aside ${r.supersededScanIds.length}` });
      }
    }
    const events = await ctx.db.query("auditEvents").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(PER_SOURCE);
    for (const e of events) {
      const a = await actorInfo(ctx, cache, e.actorId);
      entries.push({ id: `ev:${e._id}`, at: e.at, kind: e.kind, actorId: e.actorId, actorName: a.name, actorEmail: a.email, summary: e.summary, ...(e.detail ? { detail: e.detail } : {}) });
    }
    const valid = (kinds ?? []).filter((k): k is (typeof AUDIT_KINDS)[number] => (AUDIT_KINDS as readonly string[]).includes(k));
    const rows = searchAudit(entries, { query: text, kinds: valid });
    return { total: rows.length, rows: rows.slice(0, Math.min(Math.max(limit ?? 100, 1), 500)).map((r) => ({ ...r, label: AUDIT_LABEL[r.kind] })) };
  },
});

// ------------------------------------------------------------------ access: pre-authorization & requests
const grantRole = v.union(v.literal("teacher"), v.literal("admin"));

export const listAccess = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "admin");
    const pending = await ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending")).collect();
    const pre = await ctx.db.query("preAuthorizations").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return {
      pending: pending.sort((a, b) => b.requestedAt - a.requestedAt).map((r) => ({ _id: r._id, email: r.email, name: r.name ?? "", requestedAt: r.requestedAt })),
      preAuthorized: pre.sort((a, b) => a.email.localeCompare(b.email)).map((p) => ({ _id: p._id, email: p.email, role: p.role, createdAt: p.createdAt })),
    };
  },
});

/** Badge count for the header's Admin link. */
export const pendingCount = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireRole(ctx, orgId, "admin");
    return (await ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending")).collect()).length;
  },
});

/**
 * Pre-authorize faculty by email (any mix of commas / newlines). Already-registered users are bound
 * immediately; everyone else is bound the moment they sign in. Only addresses in the allowed
 * institutional domains are accepted.
 */
export const preAuthorize = mutation({
  args: { orgId: v.id("orgs"), emails: v.string(), role: grantRole },
  handler: async (ctx, { orgId, emails, role: grant }) => {
    const { user: actor } = await requireRole(ctx, orgId, "admin");
    const policy = await ctx.db.query("orgPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
    const parsed = parseEmailList(emails, allowedDomains());
    const invalid = [...parsed.invalid, ...parsed.valid.filter((e) => policy && !emailAllowedByPolicy(e, policy.allowedDomains))];
    const bound: string[] = [], queued: string[] = [], unchanged: string[] = [];
    for (const email of parsed.valid.filter((e) => !invalid.includes(e))) {
      const existing = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).first();
      if (existing) {
        const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", existing._id)).unique();
        if (m && (m.role === grant || m.role === "owner" || (m.role === "admin" && grant === "teacher"))) { unchanged.push(email); continue; }
        if (m) await ctx.db.patch(m._id, { role: grant }); else await ctx.db.insert("memberships", { orgId, userId: existing._id, role: grant });
        const req = await ctx.db.query("accessRequests").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", existing._id)).unique();
        if (req?.status === "pending") await ctx.db.patch(req._id, { status: "approved", decidedBy: actor._id, decidedAt: Date.now() });
        await logAudit(ctx, orgId, actor._id, "ROLE_CHANGE", `${email} pre-authorized as ${grant} (already signed in: bound now)`);
        bound.push(email);
        continue;
      }
      const pa = await ctx.db.query("preAuthorizations").withIndex("by_org_email", (q) => q.eq("orgId", orgId).eq("email", email)).unique();
      if (pa) await ctx.db.patch(pa._id, { role: grant }); else await ctx.db.insert("preAuthorizations", { orgId, email, role: grant, createdBy: actor._id, createdAt: Date.now() });
      await logAudit(ctx, orgId, actor._id, "ROLE_CHANGE", `${email} pre-authorized as ${grant} (binds at first sign-in)`);
      queued.push(email);
    }
    return { bound, queued, unchanged, invalid };
  },
});

export const revokePreAuthorization = mutation({
  args: { orgId: v.id("orgs"), id: v.id("preAuthorizations") },
  handler: async (ctx, { orgId, id }) => {
    const { user } = await requireRole(ctx, orgId, "admin");
    const pa = await ctx.db.get(id);
    if (!pa || pa.orgId !== orgId) fail("NOT_FOUND", "Pre-authorization not found.");
    await ctx.db.delete(id);
    await logAudit(ctx, orgId, user._id, "ROLE_CHANGE", `Pre-authorization for ${pa.email} revoked`);
  },
});

/** 1-click approval (as Teacher, or Admin) or rejection of a pending "Request Faculty Access". */
export const decideRequest = mutation({
  args: { orgId: v.id("orgs"), requestId: v.id("accessRequests"), decision: v.union(v.literal("approve"), v.literal("reject")), role: v.optional(grantRole) },
  handler: async (ctx, { orgId, requestId, decision, role: grant }) => {
    const { user: actor } = await requireRole(ctx, orgId, "admin");
    const req = await ctx.db.get(requestId);
    if (!req || req.orgId !== orgId) fail("NOT_FOUND", "Request not found.");
    if (req.status !== "pending") fail("ALREADY_DECIDED", `This request was already ${req.status}.`);
    if (decision === "reject") {
      await ctx.db.patch(requestId, { status: "rejected", decidedBy: actor._id, decidedAt: Date.now() });
      await logAudit(ctx, orgId, actor._id, "ROLE_CHANGE", `Faculty access request from ${req.email} rejected`);
      return;
    }
    const role = grant ?? "teacher";
    const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", req.userId)).unique();
    if (!m) await ctx.db.insert("memberships", { orgId, userId: req.userId, role });
    await ctx.db.patch(requestId, { status: "approved", decidedBy: actor._id, decidedAt: Date.now() });
    await logAudit(ctx, orgId, actor._id, "ROLE_CHANGE", `Faculty access request from ${req.email} approved as ${role}`);
  },
});
