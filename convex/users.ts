import { mutation, query } from "./_generated/server";
import { accessDecision, allowedDomains, currentUser, requireAllowedIdentity } from "./lib/access";

/** Upsert the signed-in user (call once after sign-in). Refuses accounts outside the allowlist. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAllowedIdentity(ctx);
    const existing = await currentUser(ctx);
    const patch = { name: identity.name ?? identity.nickname ?? undefined, email: identity.email?.trim().toLowerCase() ?? undefined };
    if (existing) {
      if (existing.name !== patch.name || existing.email !== patch.email) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return ctx.db.insert("users", { tokenIdentifier: identity.tokenIdentifier, ...patch });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => currentUser(ctx),
});

/** Why the current session can or cannot use the backend (drives the sign-in UI). */
export const accessStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const domains = allowedDomains();
    if (!identity) return { signedIn: false as const, allowed: false, domains };
    const d = accessDecision(identity);
    return d.ok
      ? { signedIn: true as const, allowed: true, email: d.email, domains }
      : { signedIn: true as const, allowed: false, email: d.email ?? null, code: d.code, message: d.message, domains };
  },
});
