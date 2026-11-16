import { describe, expect, it } from "vitest";
import {
  classFromRoster, classLabel, classToRoster, MAX_CLASS_BYTES, parseSavedClasses, removeClass, summarizeClass, upsertClass, validateClassInput, type SavedClass,
} from "@/lib/classes/classes";
import { RosterSchema } from "@/lib/roster/schema";

const students = [
  { rollNumber: "240101", name: "Tala Garcia", section: "10-A" },
  { rollNumber: "240102", name: "Noah Kumar" },
];
let n = 0;
const newId = () => `c${++n}`;
const add = (list: SavedClass[], name: string, extra: { section?: string; students?: typeof students } = {}) => {
  const r = upsertClass(list, { name, section: extra.section, students: extra.students ?? students }, { now: 10, newId });
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("validateClassInput", () => {
  it("accepts a named class with students and trims the text", () => {
    const r = validateClassInput({ name: "  CS 101  ", section: " A ", students });
    expect(r).toMatchObject({ ok: true, value: { name: "CS 101", section: "A" } });
  });
  it("needs a name and at least one student", () => {
    expect(validateClassInput({ name: " ", students })).toMatchObject({ ok: false });
    expect(validateClassInput({ name: "X", students: [] })).toMatchObject({ ok: false });
  });
  it("rejects over-long names and sections", () => {
    expect(validateClassInput({ name: "x".repeat(201), students })).toMatchObject({ ok: false });
    expect(validateClassInput({ name: "X", section: "s".repeat(101), students })).toMatchObject({ ok: false });
  });
  it("rejects a malformed student (strict, same rules as a roster)", () => {
    expect(validateClassInput({ name: "X", students: [{ rollNumber: "", name: "A" }] })).toMatchObject({ ok: false });
    expect(validateClassInput({ name: "X", students: [{ rollNumber: "1", name: "A", email: "nope" }] })).toMatchObject({ ok: false });
  });
  it("rejects two students with the same roll number (compared the way scans are)", () => {
    const r = validateClassInput({ name: "X", students: [{ rollNumber: "00123", name: "A" }, { rollNumber: "123", name: "B" }] });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/123/);
  });
  it("caps the class at 5000 students and the stored size", () => {
    const big = Array.from({ length: 5001 }, (_, i) => ({ rollNumber: String(i + 1), name: "A" }));
    expect(validateClassInput({ name: "X", students: big })).toMatchObject({ ok: false });
    const fat = Array.from({ length: 4000 }, (_, i) => ({ rollNumber: String(i + 1), name: "N".repeat(200), email: `${"e".repeat(40)}${i}@x.ph`, guardianContact: "g".repeat(200) }));
    expect(JSON.stringify(fat).length).toBeGreaterThan(MAX_CLASS_BYTES);
    expect(validateClassInput({ name: "X", students: fat })).toMatchObject({ ok: false });
  });
});

describe("upsertClass / removeClass", () => {
  it("creates a class with an id and timestamps", () => {
    const { list, saved } = add([], "CS 101", { section: "A" });
    expect(list).toEqual([saved]);
    expect(saved).toMatchObject({ name: "CS 101", section: "A", createdAt: 10, updatedAt: 10 });
    expect(saved.id).toBeTruthy();
  });
  it("updates in place, keeping id and createdAt", () => {
    const first = add([], "CS 101");
    const r = upsertClass(first.list, { name: "CS 101", students: [students[0]] }, { id: first.saved.id, now: 99, newId });
    if ("error" in r) throw new Error(r.error);
    expect(r.list).toHaveLength(1);
    expect(r.saved).toMatchObject({ id: first.saved.id, createdAt: 10, updatedAt: 99 });
    expect(r.saved.students).toHaveLength(1);
  });
  it("refuses a second class with the same name and section", () => {
    const first = add([], "CS 101", { section: "A" });
    expect(upsertClass(first.list, { name: "cs 101", section: "a", students }, { now: 1, newId })).toMatchObject({ error: expect.stringMatching(/already/i) });
    expect("error" in upsertClass(first.list, { name: "CS 101", section: "B", students }, { now: 1, newId })).toBe(false);
  });
  it("a class can be saved over itself without clashing with its own name", () => {
    const first = add([], "CS 101");
    expect("error" in upsertClass(first.list, { name: "CS 101", students }, { id: first.saved.id, now: 2, newId })).toBe(false);
  });
  it("updating an unknown id is an error, not a silent create", () => {
    expect(upsertClass([], { name: "X", students }, { id: "nope", now: 1, newId })).toMatchObject({ error: expect.any(String) });
  });
  it("removes by id and ignores unknown ids", () => {
    const a = add([], "A"); const b = add(a.list, "B");
    expect(removeClass(b.list, a.saved.id).map((c) => c.name)).toEqual(["B"]);
    expect(removeClass(b.list, "zzz")).toHaveLength(2);
  });
  it("does not change the list it was given", () => {
    const first = add([], "A");
    const snapshot = JSON.stringify(first.list);
    add(first.list, "B");
    expect(JSON.stringify(first.list)).toBe(snapshot);
  });
});

describe("attaching a class to an exam", () => {
  const c: SavedClass = { id: "c", name: "CS 101", section: "A", students, createdAt: 1, updatedAt: 2 };
  it("becomes a roster the existing per-exam linkage accepts", () => {
    const r = classToRoster(c, 123);
    expect(RosterSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ schema: "omr-roster/v1", name: "CS 101 · A", importedAt: 123 });
    expect(r.students).toEqual(students);
  });
  it("copies the students, so later edits to the class never change an exam that already used it", () => {
    const r = classToRoster(c, 1);
    r.students[0].name = "Changed";
    expect(c.students[0].name).toBe("Tala Garcia");
  });
  it("can be made from a roster that was imported for an exam", () => {
    const from = classFromRoster({ schema: "omr-roster/v1", name: "roster.csv", importedAt: 1, students }, "CS 101", "A");
    expect(from).toEqual({ name: "CS 101", section: "A", students });
  });
  it("is labelled and summarised for a picker", () => {
    expect(classLabel(c)).toBe("CS 101 · A");
    expect(classLabel({ ...c, section: undefined })).toBe("CS 101");
    expect(summarizeClass(c)).toEqual({ id: "c", name: "CS 101", section: "A", count: 2 });
  });
});

describe("parseSavedClasses (what comes back from this device's storage)", () => {
  const good: SavedClass = { id: "c", name: "CS 101", students, createdAt: 1, updatedAt: 2 };
  it("keeps valid classes", () => expect(parseSavedClasses([good])).toEqual([good]));
  it("returns nothing for missing or corrupted storage", () => {
    expect(parseSavedClasses(null)).toEqual([]);
    expect(parseSavedClasses("junk")).toEqual([]);
    expect(parseSavedClasses({ a: 1 })).toEqual([]);
  });
  it("drops a damaged entry but keeps the rest", () => {
    expect(parseSavedClasses([good, { id: "x" }, { ...good, id: "d", students: "no" }])).toEqual([good]);
  });
});
