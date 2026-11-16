/**
 * Reusable classes / sections (pure). A class is a named student list saved once; attaching it to an
 * exam copies it into that exam's roster, so the per-exam roster linkage is unchanged and later edits
 * to the class never rewrite a graded exam. The same validation runs on this device and on the server.
 */
import { z } from "zod";
import { rollKey, StudentSchema, type Roster, type Student } from "@/lib/roster/schema";

export const MAX_NAME = 200;
export const MAX_SECTION = 100;
export const MAX_STUDENTS = 5000;
/** A Convex document must stay well under 1 MiB. */
export const MAX_CLASS_BYTES = 900_000;
export const MAX_CLASSES = 100;

export interface ClassInput { name: string; section?: string; students: unknown[] }
export interface ClassValue { name: string; section?: string; students: Student[] }
export interface SavedClass extends ClassValue { id: string; createdAt: number; updatedAt: number }

const StudentsSchema = z.array(StudentSchema).min(1, "Add at least one student.").max(MAX_STUDENTS, `A class can have at most ${MAX_STUDENTS} students.`);

export function validateClassInput(input: ClassInput): { ok: true; value: ClassValue } | { ok: false; error: string } {
  const name = input.name.trim();
  const section = input.section?.trim();
  if (!name) return { ok: false, error: "Give the class a name." };
  if (name.length > MAX_NAME) return { ok: false, error: `The class name can be at most ${MAX_NAME} characters.` };
  if (section && section.length > MAX_SECTION) return { ok: false, error: `The section can be at most ${MAX_SECTION} characters.` };
  const parsed = StudentsSchema.safeParse(input.students);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.path.length ? `Student ${Number(i.path[0]) + 1}: ${i.message}` : i.message };
  }
  const seen = new Map<string, string>();
  for (const s of parsed.data) {
    const k = rollKey(s.rollNumber)!;
    if (seen.has(k)) return { ok: false, error: `Roll number ${s.rollNumber} appears twice (${seen.get(k)} and ${s.name}).` };
    seen.set(k, s.name);
  }
  if (JSON.stringify(parsed.data).length > MAX_CLASS_BYTES) return { ok: false, error: "This class is too large to save. Split it into sections." };
  return { ok: true, value: { name, ...(section ? { section } : {}), students: parsed.data } };
}

const sameName = (a: ClassValue, b: ClassValue) => a.name.toLowerCase() === b.name.toLowerCase() && (a.section ?? "").toLowerCase() === (b.section ?? "").toLowerCase();

/** Create (no id) or update (id) a class. Never mutates `list`. */
export function upsertClass(list: readonly SavedClass[], input: ClassInput, ctx: { id?: string; now: number; newId: () => string }): { list: SavedClass[]; saved: SavedClass } | { error: string } {
  const v = validateClassInput(input);
  if (!v.ok) return { error: v.error };
  const existing = ctx.id ? list.find((c) => c.id === ctx.id) : undefined;
  if (ctx.id && !existing) return { error: "That class no longer exists." };
  if (list.some((c) => c.id !== ctx.id && sameName(c, v.value))) return { error: "You already have a class with this name and section." };
  if (!existing && list.length >= MAX_CLASSES) return { error: `You can keep at most ${MAX_CLASSES} classes. Remove one first.` };
  const saved: SavedClass = { ...v.value, id: existing?.id ?? ctx.newId(), createdAt: existing?.createdAt ?? ctx.now, updatedAt: ctx.now };
  return { list: existing ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved], saved };
}

export const removeClass = (list: readonly SavedClass[], id: string): SavedClass[] => list.filter((c) => c.id !== id);

export const classLabel = (c: Pick<ClassValue, "name" | "section">) => (c.section ? `${c.name} · ${c.section}` : c.name);

/** The roster an exam gets when this class is attached (a copy). */
export function classToRoster(c: ClassValue, now: number): Roster {
  return { schema: "omr-roster/v1", name: classLabel(c), importedAt: now, students: c.students.map((s) => ({ ...s })) };
}

export const classFromRoster = (r: Roster, name: string, section?: string): ClassValue => ({ name, ...(section ? { section } : {}), students: r.students.map((s) => ({ ...s })) });

export const summarizeClass = (c: SavedClass) => ({ id: c.id, name: c.name, section: c.section, count: c.students.length });

const SavedClassSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(MAX_NAME), section: z.string().max(MAX_SECTION).optional(),
  students: z.array(StudentSchema).max(MAX_STUDENTS), createdAt: z.number(), updatedAt: z.number(),
});

/** Whatever storage returns → only the classes that are still valid (a damaged entry never breaks the rest). */
export function parseSavedClasses(raw: unknown): SavedClass[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => { const r = SavedClassSchema.safeParse(x); return r.success ? [r.data as SavedClass] : []; });
}
