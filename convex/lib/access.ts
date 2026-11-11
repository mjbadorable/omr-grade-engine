/**
 * Identity and tenancy guards. Works with any Convex auth integration (Clerk, Convex Auth,
 * custom OIDC) because it only relies on `ctx.auth.getUserIdentity()`.
 */
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Role = Doc<"memberships">["role"];
const RANK: Record<Role, number> = { viewer: 0, teacher: 1, admin: 2, owner: 3 };

export function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ConvexError({ code, message, ...extra });
}

export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");
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
