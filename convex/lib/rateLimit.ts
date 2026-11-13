/**
 * Persistent per-user rate limits for the mutations that write data or cost money. Events live in the
 * `rateEvents` table (sliding window, keyed by the verified token identifier, never a client value).
 * A refused call throws before it writes anything, so refused attempts are not recorded.
 *
 * The limits are generous on purpose: a teacher scanning and uploading a whole class (even a long
 * offline queue replaying at once) stays far below them. The offline outbox treats RATE_LIMITED as
 * transient, so a queued scan that hits a limit is retried later, never dropped.
 */
import type { MutationCtx } from "../_generated/server";
import { fail } from "./access";

export interface Rule { max: number; windowMs: number }

const MIN = 60_000;
export const LIMITS = {
  "users.store": { max: 20, windowMs: 5 * MIN },
  "orgs.ensureDefault": { max: 20, windowMs: 5 * MIN },
  "orgs.requestAccess": { max: 10, windowMs: 60 * MIN },
  "exams.create": { max: 30, windowMs: 60 * MIN },
  "examFolders.create": { max: 30, windowMs: 60 * MIN },
  "syllabi.upsert": { max: 30, windowMs: 60 * MIN },
  "grading.submitScanBatch": { max: 600, windowMs: 10 * MIN },
  "grading.generateUploadUrl": { max: 600, windowMs: 10 * MIN },
  "grading.addOverrides": { max: 120, windowMs: 10 * MIN },
} satisfies Record<string, Rule>;
export type Bucket = keyof typeof LIMITS;

const TIDY = 25;

/** Count this call against `key`'s bucket, or throw RATE_LIMITED. `key` must be a server-verified identifier. */
export async function rateLimit(ctx: MutationCtx, key: string, bucket: Bucket, rule: Rule = LIMITS[bucket]): Promise<void> {
  const now = Date.now();
  const since = now - rule.windowMs;
  const recent = await ctx.db.query("rateEvents").withIndex("by_key_bucket", (q) => q.eq("key", key).eq("bucket", bucket).gt("at", since)).collect();
  if (recent.length >= rule.max) {
    const retryAfterMs = Math.max(1, recent[0].at + rule.windowMs - now);
    fail("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { retryAfterMs });
  }
  // keep the table small: drop a few expired events of this person and bucket each time
  const expired = await ctx.db.query("rateEvents").withIndex("by_key_bucket", (q) => q.eq("key", key).eq("bucket", bucket).lte("at", since)).take(TIDY);
  for (const e of expired) await ctx.db.delete(e._id);
  await ctx.db.insert("rateEvents", { key, bucket, at: now });
}
