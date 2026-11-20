import { describe, expect, it } from "vitest";
import { TUTORIAL } from "@/lib/tutorial-content";
import { CATEGORIES, categoryForPath, markSeen, readAuto, readSeen, shouldAutoOpen, TUTORIAL_AUTO_KEY, TUTORIAL_KEY, writeAuto } from "@/lib/tutorial-state";

const mem = () => { const m = new Map<string, string>(); return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }; };

describe("route → category", () => {
  it.each([["/", "dashboard"], ["/?courseId=abc", "dashboard"], ["/designer", "design"], ["/scan", "scan"], ["/grade", "grade"], ["/grade/", "grade"], ["/admin", "admin"], ["/designer?x=1", "design"], ["/nope", null], [null, null]])("%s → %s", (p, c) => expect(categoryForPath(p as string | null)).toBe(c));
});

describe("seen map", () => {
  it("starts all false and persists per category under the agreed key", () => {
    const { m, s } = mem();
    expect(TUTORIAL_KEY).toBe("veritas_tutorial_seen_v1");
    expect(readSeen(s)).toEqual({ dashboard: false, design: false, scan: false, grade: false, admin: false });
    markSeen(["scan"], s);
    expect(readSeen(s)).toEqual({ dashboard: false, design: false, scan: true, grade: false, admin: false });
    markSeen(["design", "grade"], s);
    expect(JSON.parse(m.get(TUTORIAL_KEY)!)).toEqual({ dashboard: false, design: true, scan: true, grade: true, admin: false });
  });
  it("survives corrupt or blocked storage", () => {
    const { m, s } = mem(); m.set(TUTORIAL_KEY, "{oops");
    expect(readSeen(s).design).toBe(false);
    m.set(TUTORIAL_KEY, JSON.stringify({ design: "yes", scan: true, extra: true }));
    expect(readSeen(s)).toEqual({ dashboard: false, design: false, scan: true, grade: false, admin: false });
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(readSeen(broken).scan).toBe(false);
    expect(() => markSeen(["scan"], broken)).not.toThrow();
  });
});

describe("auto-open preference and rule", () => {
  it("is on by default and can be turned off", () => {
    const { m, s } = mem();
    expect(readAuto(s)).toBe(true);
    writeAuto(false, s); expect(m.get(TUTORIAL_AUTO_KEY)).toBe("0"); expect(readAuto(s)).toBe(false);
    writeAuto(true, s); expect(readAuto(s)).toBe(true);
  });
  it("opens only after the acknowledgment, for an unseen category, when auto is on", () => {
    const seen = { dashboard: true, design: true, scan: false, grade: false, admin: false };
    const base = { acked: true, auto: true, category: "scan" as const, seen };
    expect(shouldAutoOpen(base)).toBe(true);
    expect(shouldAutoOpen({ ...base, acked: false })).toBe(false);
    expect(shouldAutoOpen({ ...base, auto: false })).toBe(false);
    expect(shouldAutoOpen({ ...base, category: "design" })).toBe(false);
    expect(shouldAutoOpen({ ...base, category: null })).toBe(false);
  });
});

describe("seen map: guides saved before the Dashboard had its own", () => {
  it("a stored map without a dashboard key shows the Dashboard guide once, and keeps the rest", () => {
    const { m, s } = mem();
    m.set(TUTORIAL_KEY, JSON.stringify({ design: true, scan: true, grade: true }));
    expect(readSeen(s)).toEqual({ dashboard: false, design: true, scan: true, grade: true, admin: false });
    expect(shouldAutoOpen({ acked: true, auto: true, category: "dashboard", seen: readSeen(s) })).toBe(true);
    expect(shouldAutoOpen({ acked: true, auto: true, category: "design", seen: readSeen(s) })).toBe(false);
  });
  it("Dashboard is the first category", () => {
    expect(CATEGORIES).toEqual(["dashboard", "design", "scan", "grade", "admin"]);
  });
});

describe("tutorial content", () => {
  it("covers the five categories with 3–4 steps and a tip each", () => {
    expect(TUTORIAL.map((t) => t.id)).toEqual(["dashboard", "design", "scan", "grade", "admin"]);
    expect(TUTORIAL.map((t) => t.tab)).toEqual(["1 · Dashboard", "2 · Design", "3 · Scan", "4 · Grade", "Admin"]);
    expect(TUTORIAL.map((t) => t.short)).toEqual(["Dashboard", "Design", "Scan", "Grade", "Admin"]);
    expect(TUTORIAL.map((t) => t.visit)).toEqual(["/", "/designer", "/scan", "/grade", "/admin"]);
    expect(TUTORIAL[0].heading).toBe("Dashboard & Courses");
    for (const t of TUTORIAL) { expect(t.steps.length).toBeGreaterThanOrEqual(3); expect(t.steps.length).toBeLessThanOrEqual(4); expect(t.tip.length).toBeGreaterThan(20); }
  });
  it("keeps the print-at-actual-size tip on Design", () => {
    expect(TUTORIAL.find((t) => t.id === "design")!.tip).toMatch(/100% \/ Actual Size/);
  });
  it("Dashboard steps live on / and spotlight the real panels", () => {
    const d = TUTORIAL[0].steps;
    expect(d).toHaveLength(4);
    expect(d.every((s) => s.route === "/")).toBe(true);
    expect(d.map((s) => s.selectors)).toEqual([
      ['[data-testid="my-courses"]', '[data-testid="at-a-glance"]'],
      ['[data-testid="course-sections"]'],
      ['[data-testid="course-exams"]'],
      ['[data-testid="quick-actions"]'],
    ]);
  });
  it("Design starts on the designer, not the Dashboard", () => {
    const d = TUTORIAL[1].steps;
    expect(d).toHaveLength(3);
    expect(d.every((s) => s.route === "/designer")).toBe(true);
    expect(d[0].selectors).toEqual(['[data-testid="course-context-banner"]', '[data-testid="designer-steps"]']);
  });
  it("Dashboard copy names the real controls", () => {
    const text = TUTORIAL[0].steps.map((s) => `${s.title} ${s.body}`).join(" ") + TUTORIAL[0].tip;
    for (const w of ["Course", "Sections", "Examinations", "For Grading", "+ Add Course", "Edit Course", "Delete", "Select all", "Import a class roster", "Bulk Apply",
      "Open Gradebook", "Scan Sheets", "Print Sheet PDF", "Copy", "Archive", "View All", "Design Exam", "Scan & Upload", "View Gradebook", "Reports"]) expect(text).toContain(w);
    expect(TUTORIAL[0].tip).toMatch(/Print Sheet PDF/);
  });
  it("Grade copy mentions the section pills and the USA scale", () => {
    const g = TUTORIAL.find((t) => t.id === "grade")!.steps.map((s) => s.body).join(" ");
    expect(g).toMatch(/section pills/i);
    expect(g).toMatch(/USA Grading/);
    expect(g).toMatch(/Philippine/);
  });
  it("the Design guide mentions the course banner and Bulk Apply to Sections", () => {
    const d = TUTORIAL[1].steps.map((s) => s.body).join(" ");
    expect(d).toMatch(/Bulk Apply to Sections/);
    expect(d).toMatch(/course/i);
  });
});
