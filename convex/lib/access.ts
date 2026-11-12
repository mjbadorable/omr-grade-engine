/**
 * Identity and tenancy guards. Works with any Convex auth integration (Clerk, Convex Auth,
 * custom OIDC) because it only relies on `ctx.auth.getUserIdentity()`.
 * Every authenticated call is also checked against the institutional email allowlist
 * (verified email at an allowed domain), so a misconfigured auth provider cannot let
 * outside accounts in.
 */
import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { checkInstitutionalEmail, parseDomainList } from "../../src/lib/cloud/allowlist";
import { isDefaultAdmin, parseAdminEmails } from "../../src/lib/roles/bootstrap";
import { devIdentityBlocked } from "../../src/lib/cloud/auth-guard";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

import { RANK } from "../../src/lib/roles/policy";

export type Role = Doc<"memberships">["role"];

export function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ConvexError({ code, message, ...extra });
}

/** Allowed sign-in domains for this deployment (env OMR_ALLOWED_EMAIL_DOMAINS, default usa.edu.ph). */
export const allowedDomains = () => parseDomainList(process.env.OMR_ALLOWED_EMAIL_DOMAINS);

export function accessDecision(identity: UserIdentity) {
  // Defence in depth: even if a dev provider slipped into a production deployment, its tokens are refused.
  if (devIdentityBlocked(identity.issuer, process.env)) return { ok: false as const, code: "DEV_AUTH_DISABLED" as const, message: "Development sign-in is disabled on this deployment. Sign in with your @usa.edu.ph Google account.", email: identity.email };
  // OIDC providers (Clerk) arrive as `emailVerified`; custom-JWT providers keep the raw claim name.
  const verified = identity.emailVerified ?? (identity as Record<string, unknown>)["email_verified"];
  return checkInstitutionalEmail({ email: identity.email, emailVerified: verified === true || verified === "true" }, allowedDomains());
}

/** Signed-in identity that passed the institutional email check, else throws. */
export async function requireAllowedIdentity(ctx: QueryCtx | MutationCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");
  const d = accessDecision(identity);
  if (!d.ok) fail(d.code, d.message);
  return identity;
}

/** The caller's user record, or null when signed out, not registered or not allowed. */
export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !accessDecision(identity).ok) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  await requireAllowedIdentity(ctx);
  const user = await currentUser(ctx);
  if (!user) fail("USER_NOT_REGISTERED", "Call users.store after signing in.");
  return user;
}

export async function requireRole(ctx: QueryCtx | MutationCtx, orgId: Id<"orgs">, min: Role) {
  const user = await requireUser(ctx);
  const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id)).unique();
  if (!m || RANK[m.role] < RANK[min]) fail("FORBIDDEN", `This action needs the ${min} role in this school.`);
  return { user, membership: m };
}

/** Load an exam and check the caller's role in its org. */
export async function requireExam(ctx: QueryCtx | MutationCtx, examId: Id<"exams">, min: Role) {
  const exam = await ctx.db.get(examId);
  if (!exam) fail("NOT_FOUND", "Exam not found.");
  const access = await requireRole(ctx, exam.orgId, min);
  return { exam, ...access };
}

/** Append an admin-visible audit event (role changes, policy, syllabi). */
export async function logAudit(ctx: MutationCtx, orgId: Id<"orgs">, actorId: Id<"users">, kind: Doc<"auditEvents">["kind"], summary: string, detail?: string) {
  await ctx.db.insert("auditEvents", { orgId, kind, actorId, summary, ...(detail ? { detail } : {}), at: Date.now() });
}

export const defaultAdminEmails = () => parseAdminEmails(process.env.DEFAULT_ADMIN_EMAILS);

/**
 * Make a DEFAULT_ADMIN_EMAILS user an admin of one school (never demotes an owner/admin).
 * Idempotent; returns true when something changed.
 */
export async function ensureDefaultAdmin(ctx: MutationCtx, orgId: Id<"orgs">, user: Doc<"users">): Promise<boolean> {
  if (!isDefaultAdmin(user.email, defaultAdminEmails())) return false;
  const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id)).unique();
  if (m && RANK[m.role] >= RANK.admin) return false;
  if (m) await ctx.db.patch(m._id, { role: "admin" }); else await ctx.db.insert("memberships", { orgId, userId: user._id, role: "admin" });
  await logAudit(ctx, orgId, user._id, "ROLE_CHANGE", `${user.email} granted admin by DEFAULT_ADMIN_EMAILS`);
  return true;
}
