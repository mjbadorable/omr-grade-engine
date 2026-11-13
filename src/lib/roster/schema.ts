/**
 * Roster contracts. Roll numbers are compared through `rollKey`, which removes formatting
 * differences between a typed roster ("00123", "S-0123 ") and a scanned bubble grid ("0000123").
 */
import { z } from "zod";

export const StudentSchema = z.object({
  rollNumber: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  section: z.string().max(100).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(50).optional(),
  guardianContact: z.string().max(200).optional(),
});
export type Student = z.infer<typeof StudentSchema>;

export const RosterSchema = z.object({
  schema: z.literal("omr-roster/v1"),
  name: z.string().max(200),
  importedAt: z.number().int(),
  students: z.array(StudentSchema).max(5_000),
});
export type Roster = z.infer<typeof RosterSchema>;

/**
 * Canonical matching key for a roll number:
 *   trim → uppercase → drop spaces, dashes, dots, slashes → if purely numeric, strip leading zeros.
 * "00123", " 123 ", "0-0123" → "123";  "S-0123" → "S0123";  "0000" → "0".
 */
export function rollKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase().replace(/[\s\-./_]/g, "");
  if (!s) return null;
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
}
