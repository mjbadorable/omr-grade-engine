/**
 * DEFAULT_ADMIN_EMAILS: comma/space separated institutional emails (EdTech staff, deans) that are
 * made `admin` of every school automatically, so a fresh deployment has someone who can open
 * /admin without a database edit. Only emails that also pass the sign-in allowlist ever get this
 * far, and the list can only raise a role to admin (never demote, never touch an owner).
 */
export function parseAdminEmails(raw: string | undefined | null): string[] {
  // also accepts a JSON array ('["a@usa.edu.ph","b@usa.edu.ph"]'): quotes and brackets are stripped
  return [...new Set((raw ?? "").replace(/[\[\]"']/g, " ").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}
export const isDefaultAdmin = (email: string | null | undefined, list: readonly string[]) => !!email && list.includes(email.trim().toLowerCase());
