/** Parsing of pasted faculty email lists for pre-authorization. */
import { emailDomain } from "@/lib/cloud/allowlist";

export interface ParsedEmails { valid: string[]; invalid: string[] }

/** Split on commas, semicolons, whitespace and newlines; lowercase; de-duplicate. Domains (when given) must match exactly. */
export function parseEmailList(raw: string, domains?: readonly string[]): ParsedEmails {
  const valid: string[] = [], invalid: string[] = [];
  const seen = new Set<string>();
  for (const tok of raw.split(/[\s,;]+/).map((t) => t.replace(/^[<"']+|[>"']+$/g, "").trim().toLowerCase()).filter(Boolean)) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    const d = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(tok) ? emailDomain(tok) : null;
    if (d && (!domains?.length || domains.includes(d))) valid.push(tok); else invalid.push(tok);
  }
  return { valid, invalid };
}
