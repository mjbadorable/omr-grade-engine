/**
 * Institutional sign-in rule: only verified email addresses at an allowed domain (default
 * `usa.edu.ph`) may use the cloud backend. The match is exact: `x@usa.edu.ph` is allowed,
 * `x@mail.usa.edu.ph`, `x@usa.edu.ph.evil.com` and `x@notusa.edu.ph` are not.
 *
 * Enforced inside every Convex function (this file is imported by convex/lib/access.ts) and
 * mirrored in the UI only to explain why a signed-in account was refused.
 */
export const DEFAULT_ALLOWED_EMAIL_DOMAINS = ["usa.edu.ph"] as const;

export function parseDomainList(raw: string | undefined | null): string[] {
  const list = (raw ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return list.length ? list : [...DEFAULT_ALLOWED_EMAIL_DOMAINS];
}

export function emailDomain(email: string): string | null {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at !== e.indexOf("@") || at === e.length - 1) return null;
  return e.slice(at + 1);
}

export type AccessDecision =
  | { ok: true; email: string }
  | { ok: false; code: "EMAIL_REQUIRED" | "EMAIL_NOT_VERIFIED" | "DOMAIN_NOT_ALLOWED"; message: string; email?: string };

/** Decide from the identity claims issued by the auth provider (Clerk: email, email_verified). */
export function checkInstitutionalEmail(
  identity: { email?: string | null; emailVerified?: boolean | null },
  domains: readonly string[],
): AccessDecision {
  const email = identity.email?.trim().toLowerCase();
  const list = domains.map((d) => `@${d}`).join(", ");
  if (!email) return { ok: false, code: "EMAIL_REQUIRED", message: `Sign in with your institutional Google account (${list}).` };
  if (identity.emailVerified !== true) return { ok: false, code: "EMAIL_NOT_VERIFIED", email, message: `${email} is not verified by the sign-in provider.` };
  const domain = emailDomain(email);
  if (!domain || !domains.includes(domain)) return { ok: false, code: "DOMAIN_NOT_ALLOWED", email, message: `${email} is not an allowed account. Use your ${list} Google account.` };
  return { ok: true, email };
}
