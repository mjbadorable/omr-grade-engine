import { describe, expect, it } from "vitest";
import { adminModules, adminOverview } from "@/lib/admin/overview";

const values = (i: Parameters<typeof adminOverview>[0]) => adminOverview(i).map((t) => [t.id, t.value]);

describe("adminOverview", () => {
  it("returns the four tiles in order with plain labels", () => {
    expect(adminOverview({}).map((t) => [t.id, t.label])).toEqual([
      ["faculty", "Faculty Accounts"], ["pending", "Pending Access"], ["syllabi", "Syllabi"], ["exams", "Examinations"],
    ]);
  });

  it("keeps a value null (never 0) while its query is still loading", () => {
    expect(values({})).toEqual([["faculty", null], ["pending", null], ["syllabi", null], ["exams", null]]);
    expect(values({ faculty: [{}, {}], pending: undefined, syllabi: undefined, exams: [{}] })).toEqual([["faculty", 2], ["pending", null], ["syllabi", null], ["exams", 1]]);
  });

  it("uses list lengths and the pending number as-is", () => {
    expect(values({ faculty: [{}, {}, {}], pending: 4, syllabi: [{}], exams: [{}, {}] })).toEqual([["faculty", 3], ["pending", 4], ["syllabi", 1], ["exams", 2]]);
  });

  it("shows a real zero once a query has loaded empty", () => {
    expect(values({ faculty: [], pending: 0, syllabi: [], exams: [] }).map(([, v]) => v)).toEqual([0, 0, 0, 0]);
  });

  it("flags pending access as needing attention only when it is above zero", () => {
    expect(adminOverview({ pending: 2 }).find((t) => t.id === "pending")?.warn).toBe(true);
    expect(adminOverview({ pending: 0 }).find((t) => t.id === "pending")?.warn).toBe(false);
    expect(adminOverview({}).find((t) => t.id === "pending")?.warn).toBe(false);
  });
});

describe("adminModules", () => {
  it("lists the five management areas in order, linking to their ?view= pages", () => {
    expect(adminModules({}).map((m) => [m.view, m.label, m.href])).toEqual([
      ["faculty", "Faculty Management", "/admin?view=faculty"],
      ["access", "User Access & Roles", "/admin?view=access"],
      ["syllabi", "Syllabi Management", "/admin?view=syllabi"],
      ["audit", "Audit Trail", "/admin?view=audit"],
      ["policy", "Policy & Grading", "/admin?view=policy"],
    ]);
  });

  it("carries the real count for each area, null while loading, and none for Policy", () => {
    expect(adminModules({}).map((m) => m.count)).toEqual([null, null, null, null, null]);
    expect(adminModules({ faculty: [{}, {}], pending: 3, syllabi: [{}], auditTotal: 12 }).map((m) => m.count)).toEqual([2, 3, 1, 12, null]);
  });

  it("describes every area in plain language", () => {
    for (const m of adminModules({})) expect(m.description.length).toBeGreaterThan(10);
  });
});
