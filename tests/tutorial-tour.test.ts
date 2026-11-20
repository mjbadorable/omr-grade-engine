import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCompactViewport, isTyping, pickTarget, widgetOwnsEscape, placePopover, samePage, scrollDeltaForDock, spotlightBox, startIndex, tourSteps } from "@/lib/tutorial-tour";

const KNOWN_ROUTES = ["/", "/designer", "/scan", "/grade", "/admin"];

describe("tourSteps", () => {
  it("walks Dashboard, Design, Scan, Grade and (for admins only) Admin, in that order", () => {
    const cats = (admin: boolean) => [...new Set(tourSteps(admin).map((s) => s.category))];
    expect(cats(true)).toEqual(["dashboard", "design", "scan", "grade", "admin"]);
    expect(cats(false)).toEqual(["dashboard", "design", "scan", "grade"]);
  });

  it("never includes an admin step for a non-admin (no surprise trip to an Admins-only screen)", () => {
    expect(tourSteps(false).some((s) => s.route.startsWith("/admin"))).toBe(false);
  });

  it("has 4 + 3 + 4 + 4 steps for teachers and 3 more for admins", () => {
    expect(tourSteps(false)).toHaveLength(15);
    expect(tourSteps(true)).toHaveLength(18);
  });

  it("opens on the Dashboard", () => {
    expect(tourSteps(false)[0]).toMatchObject({ category: "dashboard", route: "/", id: "dashboard-1" });
  });

  it("gives every step a real route, a title, a body and at least one selector", () => {
    for (const s of tourSteps(true)) {
      expect(KNOWN_ROUTES).toContain(s.route.split("?")[0]);
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.body.length).toBeGreaterThan(20);
      expect(s.selectors.length).toBeGreaterThan(0);
    }
  });

  it("shows the Pro Tip once per category, on its last step", () => {
    const steps = tourSteps(true);
    for (const c of ["dashboard", "design", "scan", "grade", "admin"] as const) {
      const mine = steps.filter((s) => s.category === c);
      expect(mine.filter((s) => s.tip).map((s) => s.id)).toEqual([mine[mine.length - 1].id]);
    }
  });

  it("has unique step ids", () => {
    const ids = tourSteps(true).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/** Guard against inventing selectors: every selector must point at an attribute that exists in the source. */
describe("tour selectors exist in the app source", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(join(process.cwd(), "src"));
  const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

  const exists = (sel: string): boolean => {
    const m = /^\[(data-testid|aria-label)="([^"]+)"\]$/.exec(sel);
    if (!m) return false;
    const [, attr, val] = m;
    if (attr === "aria-label") return source.includes(`aria-label="${val}"`);
    if (source.includes(`data-testid="${val}"`) || source.includes(`testId="${val}"`)) return true;
    const prefix = val.replace(/-[^-]+$/, "");                      // e.g. step-tab-2 → step-tab (generated per item)
    return source.includes(`data-testid={\`${prefix}-\${`);
  };

  it.each(tourSteps(true).flatMap((s) => s.selectors.map((sel) => [s.id, sel] as const)))("%s → %s", (_id, sel) => {
    expect(exists(sel)).toBe(true);
  });
});

describe("samePage", () => {
  const at = (pathname: string, search = "") => ({ pathname, search });
  it("matches by path, ignoring a trailing slash", () => {
    expect(samePage(at("/scan"), "/scan")).toBe(true);
    expect(samePage(at("/scan/"), "/scan")).toBe(true);
    expect(samePage(at("/grade"), "/scan")).toBe(false);
  });
  it("a route without a query matches any query on that page", () => {
    expect(samePage(at("/grade", "?tab=key"), "/grade")).toBe(true);
  });
  it("a route with a query needs those values", () => {
    expect(samePage(at("/grade", "?tab=key"), "/grade?tab=key")).toBe(true);
    expect(samePage(at("/grade", "?tab=analysis"), "/grade?tab=key")).toBe(false);
    expect(samePage(at("/grade"), "/grade?tab=key")).toBe(false);
    expect(samePage(at("/admin", "view=overview&x=1"), "/admin?view=overview")).toBe(true);
  });
});

describe("startIndex", () => {
  const steps = tourSteps(true);
  const here = (pathname: string, search = "") => ({ pathname, search });
  it("starts a category on the first step that lives on the page you are already on", () => {
    expect(steps[startIndex(steps, "design", here("/designer"))]).toMatchObject({ category: "design", route: "/designer", id: "design-1" });
    expect(steps[startIndex(steps, "dashboard", here("/"))]).toMatchObject({ category: "dashboard", id: "dashboard-1" });
    expect(steps[startIndex(steps, "grade", here("/grade", "?tab=key"))].id).toBe("grade-1");
  });
  it("otherwise starts on the category's first step", () => {
    expect(startIndex(steps, "scan", here("/"))).toBe(steps.findIndex((s) => s.category === "scan"));
    expect(steps[startIndex(steps, "design", here("/"))]).toMatchObject({ category: "design", id: "design-1" });
  });
  it("falls back to the very first step when the category has no steps (e.g. admin for a teacher)", () => {
    const teacher = tourSteps(false);
    expect(startIndex(teacher, "admin", here("/admin"))).toBe(0);
    expect(startIndex(teacher, null, here("/nope"))).toBe(0);
  });
});

describe("pickTarget", () => {
  it("returns the first candidate that exists and is usable", () => {
    const els: Record<string, { w: number } | null> = { a: null, b: { w: 0 }, c: { w: 10 }, d: { w: 20 } };
    expect(pickTarget(["a", "b", "c", "d"], (s) => els[s], (e) => e.w > 0)).toEqual({ w: 10 });
  });
  it("is null when nothing is mounted or visible (centered fallback)", () => {
    expect(pickTarget(["a", "b"], () => null, () => true)).toBeNull();
    expect(pickTarget([], () => ({}), () => true)).toBeNull();
  });
});

describe("isCompactViewport", () => {
  it("is true below 640px", () => {
    expect(isCompactViewport(375)).toBe(true);
    expect(isCompactViewport(639)).toBe(true);
    expect(isCompactViewport(640)).toBe(false);
  });
});

describe("spotlightBox", () => {
  it("pads the target on every side", () => {
    expect(spotlightBox({ top: 100, left: 50, width: 200, height: 40 }, 8)).toEqual({ top: 92, left: 42, width: 216, height: 56 });
  });
});

describe("placePopover", () => {
  const vp = { w: 1280, h: 800 };
  const card = { w: 360, h: 240 };
  const box = (top: number, left: number, width: number, height: number) => ({ top, left, width, height });

  it("centers the card when there is no target", () => {
    expect(placePopover(null, vp, card)).toEqual({ mode: "center" });
  });

  it("docks as a bottom card on phones, with or without a target", () => {
    expect(placePopover(box(100, 10, 200, 40), { w: 375, h: 812 }, card)).toEqual({ mode: "dock" });
    expect(placePopover(null, { w: 375, h: 812 }, card)).toEqual({ mode: "dock" });
  });

  it("goes below the target when there is room", () => {
    expect(placePopover(box(100, 300, 400, 60), vp, card)).toEqual({ mode: "anchored", placement: "below", top: 160 + 16, left: 300 });
  });

  it("goes above when there is no room below", () => {
    const p = placePopover(box(600, 300, 400, 100), vp, card);
    expect(p).toEqual({ mode: "anchored", placement: "above", top: 600 - 16 - 240, left: 300 });
  });

  it("keeps the card inside the viewport horizontally", () => {
    const p = placePopover(box(100, 1200, 70, 40), vp, card);
    expect(p.mode === "anchored" && p.left).toBe(1280 - 360 - 8);
    const q = placePopover(box(100, -50, 70, 40), vp, card);
    expect(q.mode === "anchored" && q.left).toBe(8);
  });

  it("goes beside a target that is as tall as the screen, and centers when nothing fits", () => {
    const tall = placePopover(box(8, 8, 300, 784), vp, card);
    expect(tall).toMatchObject({ mode: "anchored", placement: "right", left: 8 + 300 + 16 });
    expect(placePopover(box(0, 0, 1280, 800), vp, card)).toEqual({ mode: "center" });
  });
});

describe("scrollDeltaForDock", () => {
  const H = 812, dock = 280;
  it("is 0 when the target already clears the bottom card and the top bar", () => {
    expect(scrollDeltaForDock({ top: 120, left: 0, width: 300, height: 100 }, H, dock, 56)).toBe(0);
  });
  it("scrolls down just enough to lift a target out from behind the bottom card", () => {
    // bottom at 700; limit = 812 - 280 - 16 = 516 → scroll down 184
    expect(scrollDeltaForDock({ top: 600, left: 0, width: 300, height: 100 }, H, dock, 56)).toBe(184);
  });
  it("never scrolls the target's top under the top bar", () => {
    // very tall target: align its top just under the bar (56 + 16 = 72) instead of showing the bottom
    expect(scrollDeltaForDock({ top: 300, left: 0, width: 300, height: 600 }, H, dock, 56)).toBe(300 - 72);
  });
  it("scrolls up when the target sits above the visible area", () => {
    expect(scrollDeltaForDock({ top: 10, left: 0, width: 300, height: 50 }, H, dock, 56)).toBe(10 - 72);
  });
});

describe("isTyping (keys that must not step the tour)", () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, closest: () => null, ...extra });
  const inside = (role: string) => el("BUTTON", { closest: (sel: string) => (sel.includes(`[role="${role}"]`) ? {} : null) });
  it("treats form fields and editable text as typing", () => {
    for (const t of ["INPUT", "TEXTAREA", "SELECT"]) expect(isTyping(el(t))).toBe(true);
    expect(isTyping(el("DIV", { isContentEditable: true }))).toBe(true);
  });
  it("treats the custom Select and the row menus as interactive (combobox, listbox, option, menu, menuitem)", () => {
    for (const r of ["combobox", "listbox", "option", "menu", "menuitem"]) expect(isTyping(inside(r)), r).toBe(true);
  });
  it("lets plain buttons, links and the page itself step the tour", () => {
    expect(isTyping(el("BUTTON"))).toBe(false);
    expect(isTyping(el("A"))).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(isTyping(undefined)).toBe(false);
    expect(isTyping({})).toBe(false);
  });
});

describe("widgetOwnsEscape (Escape closes an open dropdown or menu, not the tour as well)", () => {
  const inPopup = { tagName: "BUTTON", closest: (sel: string) => (sel.includes('[role="menu"]') || sel.includes('[role="listbox"]') ? {} : null) };
  const plain = { tagName: "BUTTON", closest: () => null };
  it("is true when the key was already handled (the Select calls preventDefault)", () => {
    expect(widgetOwnsEscape({ defaultPrevented: true, target: plain })).toBe(true);
  });
  it("is true inside an open menu or listbox", () => {
    expect(widgetOwnsEscape({ defaultPrevented: false, target: inPopup })).toBe(true);
  });
  it("is false on the page, in a text field, or on a closed Select, so Escape still closes the tour", () => {
    expect(widgetOwnsEscape({ defaultPrevented: false, target: plain })).toBe(false);
    expect(widgetOwnsEscape({ defaultPrevented: false, target: { tagName: "INPUT", closest: () => null } })).toBe(false);
    expect(widgetOwnsEscape({})).toBe(false);
  });
});

describe("TutorialModal", () => {
  const modal = readFileSync(join(process.cwd(), "src/components/brand/TutorialModal.tsx"), "utf8");
  it("uses the shared isTyping check for its arrow keys", () => {
    expect(modal).toMatch(/import \{[^}]*\bisTyping\b[^}]*\} from "@\/lib\/tutorial-tour"/);
    expect(modal).toMatch(/if \(isTyping\(e\.target\)/);
    expect(modal).toMatch(/if \(e\.key === "Escape"\) \{ if \(widgetOwnsEscape\(e\)\) return;/);
  });
  it("labels every category, including Dashboard, and keeps 44px touch targets on the pills", () => {
    expect(modal).toMatch(/CATEGORY_LABEL[^=]*= \{ dashboard: "Dashboard", design: "Design", scan: "Scan", grade: "Grade", admin: "Admin" \}/);
    const pill = /data-testid=\{`tour-cat-\$\{c\}`\}[\s\S]*?className=\{`([^`]*)`/.exec(modal);
    expect(pill?.[1]).toContain("[@media(pointer:coarse)]:min-h-11");
  });
  it("keeps 44px touch targets on the footer buttons and the auto-open checkbox row too", () => {
    const COARSE = "[@media(pointer:coarse)]:min-h-11";
    const classOf = (anchor: string) => { const at = modal.indexOf(anchor); return at < 0 ? "" : /className="([^"]*)"/.exec(modal.slice(at, at + 400))?.[1] ?? ""; };
    expect(classOf('data-testid="tutorial-done" className')).toContain(COARSE);          // Skip
    expect(classOf('aria-label="Previous step"')).toContain(COARSE);
    expect(classOf('aria-label="Next step"')).toContain(COARSE);
    expect(/<label className="[^"]*\[@media\(pointer:coarse\)\]:min-h-11[^"]*">\s*<input id="tutorial-auto-off"/.test(modal)).toBe(true);
    expect(modal.match(/data-testid="tutorial-done"/g)).toHaveLength(2);                  // Skip and Finish
  });
  it("paints the Next / Finish buttons with the accessible solid brand (white on it is at least 4.5:1 in both themes)", () => {
    const primary = [...modal.matchAll(/className="([^"]*v-btn-primary[^"]*)"/g)].map((m) => m[1]);
    expect(primary).toHaveLength(2);
    for (const c of primary) expect(c).toContain("bg-[var(--brand-solid)] text-white");
  });
  it("draws every icon the guide uses", () => {
    for (const s of tourSteps(true)) expect(modal, s.icon).toMatch(new RegExp(`\\b${s.icon}: `));
  });
});

/** Copy that names a control must name one that exists. */
describe("tour copy names real controls", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const ui = ["src/components/courses/Courses.tsx", "src/components/dashboard/Dashboard.tsx", "src/components/designer/CourseContextBanner.tsx", "src/components/grading/GradeApp.tsx", "src/components/grading/KeyEditor.tsx", "src/components/grading/RosterPanel.tsx"].map(read).join("\n") + read("src/lib/grading/grade-scales.ts") + read("src/lib/dashboard.ts");
  it.each(["Open Gradebook", "Scan Sheets", "Print Sheet PDF", "Copy", "Archive", "Restore", "Delete", "View All", "Select all", "Import a class roster", "+ Add Course", "Edit Course", "Bulk Apply to Sections", "For Grading", "View Gradebook", "Scan & Upload", "Reports →", "USA Grading", "Grading Scale &amp; Key Tools"])("%s", (label) => {
    expect(ui).toContain(label);
  });
});
