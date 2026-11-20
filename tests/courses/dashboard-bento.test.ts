import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { atAGlance, dashboardKpis } from "@/lib/dashboard";

const course = (n: number) => ({ sections: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })) });
const glance = (exams: number | null, scanned: number | null) => {
  const g = atAGlance({ exams: exams === null ? undefined : Array.from({ length: exams }, (_, i) => ({ _id: `e${i}`, name: "x", layoutHash: `h${i}`, status: "open", createdAt: i })), localScanCount: scanned });
  return g;
};

describe("dashboardKpis (the 4-tile strip)", () => {
  it("lists Courses, Sections, Examinations, For Grading in order", () => {
    expect(dashboardKpis({ courses: [course(2)], coursesLoaded: true, glance: glance(3, 5) })).toEqual([
      { id: "courses", label: "Course", value: 1 },
      { id: "sections", label: "Sections", value: 2 },
      { id: "exams", label: "Examinations", value: 3 },
      { id: "scanned", label: "For Grading", value: 5 },
    ]);
  });
  it("pluralises Course / Courses and totals sections across every course", () => {
    const k = dashboardKpis({ courses: [course(3), course(4)], coursesLoaded: true, glance: glance(0, 0) });
    expect([k[0].label, k[0].value, k[1].value]).toEqual(["Courses", 2, 7]);
    expect(dashboardKpis({ courses: [], coursesLoaded: true, glance: glance(0, 0) })[0]).toEqual({ id: "courses", label: "Courses", value: 0 });
  });
  it("a loaded zero stays 0, an unknown value stays null (shown as a dash), never made up", () => {
    const loaded = dashboardKpis({ courses: [], coursesLoaded: true, glance: glance(0, 0) });
    expect(loaded.map((t) => t.value)).toEqual([0, 0, 0, 0]);
    const unknown = dashboardKpis({ courses: [], coursesLoaded: false, glance: glance(null, null) });
    expect(unknown.map((t) => t.value)).toEqual([null, null, null, null]);
  });
});

const read = (p: string) => readFileSync(p, "utf8");
const dash = read("src/components/dashboard/Dashboard.tsx");
const courses = read("src/components/courses/Courses.tsx");
const menu = read("src/components/courses/ActionMenu.tsx");

describe("dashboard bento layout", () => {
  it("uses the three rows: KPI strip, course + quick actions, sections + course exams", () => {
    expect(dash).toContain("grid grid-cols-2 gap-4 lg:grid-cols-4");
    expect(dash).toContain("xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]");
    expect(dash).toContain("grid grid-cols-1 gap-6 xl:grid-cols-2");
    expect(dash).toContain("grid grid-cols-1 gap-3 sm:grid-cols-3");
  });
  it("keeps every hook the tutorial, tests and features rely on", () => {
    for (const id of ["at-a-glance", "quick-actions", "recent-exams", "semester-folders-bar", "new-folder-btn", "dashboard-greeting", "recent-row", "data-testid={`action-${a.id}`}", "action-reports"]) expect(dash).toContain(id);
    for (const id of ["my-courses", "create-course-btn", "edit-course", "delete-course", "course-sections", "select-all-sections", "section-select-checkbox", "section-row", "section-class-select", "design-for-section", "remove-section", "new-section-input", "add-section", "import-roster-btn", "bulk-apply-bar", "bulk-apply-source", "bulk-apply-name", "bulk-apply-submit", "bulk-apply-status", "course-exams", "view-all-exams-btn", "course-exam-row", "exam-scope-pill", "course-pill"]) expect(courses).toContain(id);
  });
  it("keeps Reports one click away and Design Exam pointing at the active course", () => {
    expect(dash).toContain("/grade?tab=analysis");
    expect(dash).toMatch(/designHref\(course\.id\)/);
  });
  it("shows no fabricated stats: values come from dashboardKpis and a dash while unknown", () => {
    expect(dash).toContain("dashboardKpis(");
    expect(dash).not.toMatch(/value:\s*"\d/);
  });
  it("row actions live in an accessible ⋯ menu: Escape, outside press, portal, 44px touch targets", () => {
    for (const s of ['aria-haspopup="menu"', "aria-expanded", '"Escape"', "pointerdown", "createPortal", 'role="menuitem"', "[@media(pointer:coarse)]:min-h-11"]) expect(menu).toContain(s);
    expect(courses).toContain("ActionMenu");
    for (const s of ["Open Gradebook", "Scan Sheets", "Print Sheet PDF", "Copy", "Archive", "Restore", "Delete"]) expect(courses).toContain(`"${s}"`);
  });
  it("renders the decorative Augustinian belfry backdrop without trapping modals beneath the sticky header", () => {
    const shell = read("src/components/shell/AppShell.tsx");
    const icons = read("src/components/dashboard/icons.tsx");
    expect(shell).toContain("CampusBackdrop");
    expect(shell).toContain("overflow-x-clip");
    expect(shell).not.toContain("relative isolate");
    expect(shell).not.toContain("relative z-10");
    for (const s of ['aria-hidden="true"', "pointer-events-none", "print:hidden", "-z-10", "usa-belfry-fade"]) expect(icons).toContain(s);
  });
  it("gives all enabled buttons a pointer hand cursor and hover transition globally", () => {
    const css = read("src/app/globals.css");
    for (const s of ["button:not(:disabled)", "cursor: pointer", "button:disabled", "cursor: not-allowed", "transition:"]) expect(css).toContain(s);
  });
  it("filters course exams by section and offers one-click scan / reprint / open", () => {
    for (const id of ["course-exam-filter", "course-exam-filter-pill", "course-exams-filter-empty", "course-exam-open", "exam-open", "exam-scan", "exam-print", "confirm-delete-exam"]) expect(courses).toContain(id);
    expect(courses).toMatch(/filterExamsByScope\(course, exams, activeScope\)[^;]*;\s*const shown = filtered\.slice\(0, PREVIEW_ROWS\)/);
    expect(courses).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(dash).toMatch(/onScan:[\s\S]*router\.push\("\/scan"\)/);
    expect(dash).toMatch(/onPrint:[\s\S]*downloadExamPdf/);
    expect(dash.match(/onScan: \(r\)/g)).toHaveLength(2);
    expect(dash.match(/onPrint:\s*async \(r\)/g)).toHaveLength(2);
  });
  it("uses the 3D crystal Select listbox instead of boxy native <select> popups", () => {
    const sel = read("src/components/ui/Select.tsx");
    const css = read("src/app/globals.css");
    const bar = read("src/components/shell/ActiveExamBar.tsx");
    for (const s of ['role="combobox"', 'role="listbox"', 'role="option"', "createPortal", "ArrowDown", "ArrowUp", '"Escape"', "v-select-trigger", "v-select-popover", "disabled={disabled}"]) expect(sel).toContain(s);
    for (const s of [".v-select-trigger", ".v-select-popover", "@keyframes v-pop", "backdrop-filter"]) expect(css).toContain(s);
    expect(bar).toContain('fill ? "left-0" : "right-0"');
    for (const src of [dash, courses]) {
      expect(src).toContain("Select");
      expect(src).not.toContain("<select");
    }
  });
});
