import { mutation, query } from "./_generated/server";
import { currentUser, fail } from "./lib/access";

/** Upsert the signed-in user (call once after sign-in). */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");
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
