/**
 * Length and count caps for arguments that Convex validators cannot bound (free text, id strings,
 * lists). Refusing oversized input early keeps storage, audit rows and processing time bounded.
 */
import { fail } from "./access";

export const MAX = {
  /** exam / school names */
  name: 200,
  /** a correction's reason in the audit log */
  reason: 500,
  /** client-generated ids (scan, patch, device, key ids) and roll keys */
  id: 100,
  /** layout hash */
  hash: 64,
  email: 254,
  domain: 253,
  /** pasted faculty email list */
  emails: 20_000,
  emailCount: 500,
  domains: 50,
  /** corrections per call */
  patches: 500,
  /** question → outcome entries */
  outcomes: 2_000,
} as const;

export function atMost(label: string, value: string, max: number): void {
  if (value.length > max) fail("TOO_LONG", `${label} is too long (at most ${max} characters).`);
}

export function atMostCount(label: string, count: number, max: number): void {
  if (count > max) fail("TOO_MANY", `Too many ${label} (at most ${max}).`);
}
