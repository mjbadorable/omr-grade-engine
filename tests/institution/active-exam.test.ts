import { describe, expect, it } from "vitest";
import { resolveActiveExam, ROLE_LABEL, shouldAutoSave } from "@/lib/active-exam";

const exams = [{ _id: "e1", name: "IT 321 Prelim", layoutHash: "AAA" }, { _id: "e2", name: "IT 321 Midterm", layoutHash: "BBB" }];

describe("resolveActiveExam", () => {
  it("a selected cloud exam is the active one", () => {
    expect(resolveActiveExam({ exams, selectedExamId: "e2", local: { title: "x", layoutHash: "ZZZ" } })).toEqual({ kind: "cloud", exam: exams[1] });
  });
  it("a sheet already saved as an exam is matched by its layout hash", () => {
    expect(resolveActiveExam({ exams, selectedExamId: null, local: { title: "IT 321 Prelim", layoutHash: "AAA" } })).toEqual({ kind: "match", exam: exams[0] });
  });
  it("a new sheet is a draft; nothing at all is none", () => {
    expect(resolveActiveExam({ exams, selectedExamId: null, local: { title: "New exam", layoutHash: "CCC" } })).toEqual({ kind: "draft", title: "New exam", layoutHash: "CCC" });
    expect(resolveActiveExam({ exams, selectedExamId: null, local: null })).toEqual({ kind: "none" });
    expect(resolveActiveExam({ exams: undefined, selectedExamId: "e1", local: null })).toEqual({ kind: "none" });
  });
  it("a stale selection (exam no longer listed) falls back to the local sheet", () => {
    expect(resolveActiveExam({ exams, selectedExamId: "gone", local: { title: "t", layoutHash: "BBB" } }).kind).toBe("match");
  });
});

describe("shouldAutoSave", () => {
  const draft = { kind: "draft" as const, title: "New", layoutHash: "CCC" };
  const base = { active: draft, signedIn: true, role: "teacher" as const, path: "/scan", printedHash: null, inFlight: new Set<string>(), examsLoaded: true };
  it("saves the draft when the teacher reaches Scan or Grade, or prints it", () => {
    expect(shouldAutoSave(base)).toBe(true);
    expect(shouldAutoSave({ ...base, path: "/grade" })).toBe(true);
    expect(shouldAutoSave({ ...base, path: "/designer" })).toBe(false);                       // still designing: no exam spam
    expect(shouldAutoSave({ ...base, path: "/designer", printedHash: "CCC" })).toBe(true);
    expect(shouldAutoSave({ ...base, path: "/designer", printedHash: "OLD" })).toBe(false);
  });
  it("never for viewers, signed-out users, loading lists, duplicates or non-drafts", () => {
    expect(shouldAutoSave({ ...base, role: "viewer" })).toBe(false);
    expect(shouldAutoSave({ ...base, role: null })).toBe(false);
    expect(shouldAutoSave({ ...base, signedIn: false })).toBe(false);
    expect(shouldAutoSave({ ...base, examsLoaded: false })).toBe(false);
    expect(shouldAutoSave({ ...base, inFlight: new Set(["CCC"]) })).toBe(false);
    expect(shouldAutoSave({ ...base, active: { kind: "none" } })).toBe(false);
    expect(shouldAutoSave({ ...base, role: "admin" })).toBe(true);
  });
  it("labels roles for the header badge", () => {
    expect(ROLE_LABEL).toEqual({ owner: "Owner", admin: "Admin", teacher: "Teacher", viewer: "Viewer" });
  });
});
