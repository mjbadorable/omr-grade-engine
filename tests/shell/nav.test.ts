import { describe, expect, it } from "vitest";
import { activeNav, breadcrumb, parseAdminView, parseGradeTab, shellNav } from "@/lib/shell-nav";

describe("shellNav", () => {
  it("lists the main destinations in order", () => {
    expect(shellNav(null).main.map((n) => [n.id, n.label, n.href])).toEqual([
      ["dashboard", "Dashboard", "/"],
      ["design", "Design Exam", "/designer"],
      ["scan", "Scan & Upload", "/scan"],
      ["grade", "Gradebook", "/grade"],
      ["reports", "Reports", "/grade?tab=analysis"],
    ]);
  });

  it("hides Administration unless the role is admin or owner", () => {
    for (const role of [null, undefined, "viewer", "teacher"] as const) expect(shellNav(role).admin).toBeNull();
    for (const role of ["admin", "owner"] as const) expect(shellNav(role).admin).not.toBeNull();
  });

  it("gives Administration an Overview plus five sub-links, each tied to a ?view= value", () => {
    expect(shellNav("admin").admin!.map((a) => [a.view, a.label, a.href])).toEqual([
      ["overview", "Overview", "/admin?view=overview"],
      ["faculty", "Faculty Management", "/admin?view=faculty"],
      ["access", "User Access & Roles", "/admin?view=access"],
      ["syllabi", "Syllabi Management", "/admin?view=syllabi"],
      ["audit", "Audit Trail", "/admin?view=audit"],
      ["policy", "Policy & Grading", "/admin?view=policy"],
    ]);
  });
});

describe("activeNav", () => {
  it("matches each route", () => {
    expect(activeNav("/")).toBe("dashboard");
    expect(activeNav("/designer")).toBe("design");
    expect(activeNav("/scan")).toBe("scan");
    expect(activeNav("/grade")).toBe("grade");
    expect(activeNav("/admin")).toBe("admin");
  });
  it("ignores a trailing slash and nested paths", () => {
    expect(activeNav("/grade/")).toBe("grade");
    expect(activeNav("/admin/anything")).toBe("admin");
  });
  it("treats the analysis and outcomes tabs of the gradebook as Reports", () => {
    expect(activeNav("/grade", "?tab=analysis")).toBe("reports");
    expect(activeNav("/grade", "tab=outcomes")).toBe("reports");
    expect(activeNav("/grade", "?tab=gradebook")).toBe("grade");
    expect(activeNav("/grade", "?tab=nonsense")).toBe("grade");
  });
  it("is null for unknown paths", () => {
    expect(activeNav("/nope")).toBeNull();
    expect(activeNav(null)).toBeNull();
  });
});

describe("breadcrumb", () => {
  it("is the page name, with the admin view as a second crumb", () => {
    expect(breadcrumb("/designer")).toEqual(["Design Exam"]);
    expect(breadcrumb("/")).toEqual(["Dashboard"]);
    expect(breadcrumb("/grade", "?tab=analysis")).toEqual(["Reports"]);
    expect(breadcrumb("/admin", "?view=audit")).toEqual(["Administration", "Audit Trail"]);
    expect(breadcrumb("/admin")).toEqual(["Administration", "Overview"]);
    expect(breadcrumb("/admin", "?view=faculty")).toEqual(["Administration", "Faculty Management"]);
  });
  it("is empty for unknown paths", () => {
    expect(breadcrumb("/nope")).toEqual([]);
  });
});

describe("parseAdminView", () => {
  it("accepts the six views and falls back to the overview", () => {
    for (const v of ["overview", "faculty", "access", "syllabi", "audit", "policy"]) expect(parseAdminView(v)).toBe(v);
    for (const v of ["", "Faculty", "../x", null, undefined]) expect(parseAdminView(v)).toBe("overview");
  });
});

describe("parseGradeTab", () => {
  it("accepts the five gradebook tabs and returns null otherwise", () => {
    for (const v of ["key", "gradebook", "roster", "analysis", "outcomes"]) expect(parseGradeTab(v)).toBe(v);
    for (const v of ["", "results", null, undefined]) expect(parseGradeTab(v)).toBeNull();
  });
});
