import { describe, expect, it } from "vitest";
import { TUTORIAL } from "@/lib/tutorial-content";
import { categoryForPath, markSeen, readAuto, readSeen, shouldAutoOpen, TUTORIAL_AUTO_KEY, TUTORIAL_KEY, writeAuto } from "@/lib/tutorial-state";

const mem = () => { const m = new Map<string, string>(); return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }; };

describe("route → category", () => {
  it.each([["/", "design"], ["/designer", "design"], ["/scan", "scan"], ["/grade", "grade"], ["/grade/", "grade"], ["/admin", "admin"], ["/designer?x=1", "design"], ["/nope", null], [null, null]])("%s → %s", (p, c) => expect(categoryForPath(p as string | null)).toBe(c));
});

describe("seen map", () => {
  it("starts all false and persists per category under the agreed key", () => {
    const { m, s } = mem();
    expect(TUTORIAL_KEY).toBe("veritas_tutorial_seen_v1");
    expect(readSeen(s)).toEqual({ design: false, scan: false, grade: false, admin: false });
    markSeen(["scan"], s);
    expect(readSeen(s)).toEqual({ design: false, scan: true, grade: false, admin: false });
    markSeen(["design", "grade"], s);
    expect(JSON.parse(m.get(TUTORIAL_KEY)!)).toEqual({ design: true, scan: true, grade: true, admin: false });
  });
  it("survives corrupt or blocked storage", () => {
    const { m, s } = mem(); m.set(TUTORIAL_KEY, "{oops");
    expect(readSeen(s).design).toBe(false);
    m.set(TUTORIAL_KEY, JSON.stringify({ design: "yes", scan: true, extra: true }));
    expect(readSeen(s)).toEqual({ design: false, scan: true, grade: false, admin: false });
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
    const seen = { design: true, scan: false, grade: false, admin: false };
    const base = { acked: true, auto: true, category: "scan" as const, seen };
    expect(shouldAutoOpen(base)).toBe(true);
    expect(shouldAutoOpen({ ...base, acked: false })).toBe(false);
    expect(shouldAutoOpen({ ...base, auto: false })).toBe(false);
    expect(shouldAutoOpen({ ...base, category: "design" })).toBe(false);
    expect(shouldAutoOpen({ ...base, category: null })).toBe(false);
  });
});

describe("tutorial content", () => {
  it("covers the four categories with 3–4 steps and a tip each", () => {
    expect(TUTORIAL.map((t) => t.id)).toEqual(["design", "scan", "grade", "admin"]);
    expect(TUTORIAL.map((t) => t.tab)).toEqual(["1 · Design", "2 · Scan", "3 · Grade", "Admin"]);
    for (const t of TUTORIAL) { expect(t.steps.length).toBeGreaterThanOrEqual(3); expect(t.steps.length).toBeLessThanOrEqual(4); expect(t.tip.length).toBeGreaterThan(20); }
    expect(TUTORIAL[0].tip).toMatch(/100% \/ Actual Size/);
  });
});
