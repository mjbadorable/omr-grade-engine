import { describe, expect, it } from "vitest";
import { ALL_SECTIONS_KEY, examScopeOptions, filterExamsByScope, hasScopeChoice, scopeOptionLabel } from "@/lib/courses/courses";

const course = { sections: [{ id: "s1", name: "BS-HM 1-A" }, { id: "s2", name: "BS-HM 2-A" }, { id: "s3", name: "BS-HM 2-B" }] };
const row = (key: string, sectionId: string | null) => ({ key, sectionId });
const rows = [row("a", "s1"), row("b", null), row("c", "s2"), row("d", "s1"), row("e", "gone")];

describe("course exam scope filter", () => {
  it("lists All, then All sections (only when some exam covers them), then every course section with its count", () => {
    expect(examScopeOptions(course, rows)).toEqual([
      { key: "", label: "All", count: 5 },
      { key: ALL_SECTIONS_KEY, label: "All sections", count: 2 },
      { key: "s1", label: "BS-HM 1-A", count: 2 },
      { key: "s2", label: "BS-HM 2-A", count: 1 },
      { key: "s3", label: "BS-HM 2-B", count: 0 },
    ]);
    expect(examScopeOptions(course, [row("x", "s2")]).map((o) => o.key)).toEqual(["", "s1", "s2", "s3"]);
  });
  it("treats an exam scoped to a section that no longer exists as covering all sections", () => {
    expect(filterExamsByScope(course, rows, ALL_SECTIONS_KEY).map((r) => r.key)).toEqual(["b", "e"]);
  });
  it("filters by one section, or returns everything for All, keeping the order", () => {
    expect(filterExamsByScope(course, rows, "s1").map((r) => r.key)).toEqual(["a", "d"]);
    expect(filterExamsByScope(course, rows, "").map((r) => r.key)).toEqual(["a", "b", "c", "d", "e"]);
    expect(filterExamsByScope(course, rows, "s3")).toEqual([]);
  });
  it("an unknown filter key matches nothing rather than everything", () => {
    expect(filterExamsByScope(course, rows, "zzz")).toEqual([]);
  });
  it("offers the filter only when the exams span two or more scopes", () => {
    expect(hasScopeChoice(course, [])).toBe(false);
    expect(hasScopeChoice(course, [row("a", "s1"), row("d", "s1")])).toBe(false);
    expect(hasScopeChoice(course, [row("b", null), row("e", "gone")])).toBe(false);
    expect(hasScopeChoice(course, [row("a", "s1"), row("b", null)])).toBe(true);
    expect(hasScopeChoice(course, [row("a", "s1"), row("c", "s2")])).toBe(true);
  });
  it("names a scope for messages", () => {
    expect(scopeOptionLabel(course, "s2")).toBe("BS-HM 2-A");
    expect(scopeOptionLabel(course, ALL_SECTIONS_KEY)).toBe("All sections");
    expect(scopeOptionLabel(course, "")).toBe("All");
  });
});
