import { describe, expect, it } from "vitest";
import { atAGlance, dashboardRows, firstName, greeting, type WorkspaceExam } from "@/lib/dashboard";

const cloud = (over: Partial<WorkspaceExam> = {}): WorkspaceExam => ({ _id: "e1", name: "Midterm", layoutHash: "AAA", status: "open", currentKeyVersion: 2, examPeriod: "MIDTERM", createdAt: 1000, ...over });
const local = { title: "Quiz 1", layoutHash: "LLL" };

describe("greeting", () => {
  it("follows the hour of the day", () => {
    expect([greeting(5), greeting(11), greeting(12), greeting(17), greeting(18), greeting(23), greeting(0)]).toEqual([
      "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening", "Good evening",
    ]);
  });
});

describe("firstName", () => {
  it("uses the first word of the real display name", () => {
    expect(firstName("Marvin Jhay Adorable")).toBe("Marvin");
    expect(firstName("  Ana  ")).toBe("Ana");
  });
  it("is null when there is no name (never guessed from an email)", () => {
    expect(firstName(undefined)).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName("   ")).toBeNull();
  });
});

describe("dashboardRows", () => {
  it("is empty with nothing on the device and no workspace exams", () => {
    expect(dashboardRows({ local: null, localScanCount: null, exams: [] })).toEqual([]);
  });

  it("shows the sheet on this device as a draft, with its scanned count when known", () => {
    const [r] = dashboardRows({ local, localScanCount: 12, exams: [] });
    expect(r).toMatchObject({ name: "Quiz 1", where: "This device", status: "Draft", scanned: 12, createdAt: null, period: null });
  });

  it("uses a dash-able null for the scanned count while it is unknown", () => {
    expect(dashboardRows({ local, localScanCount: null, exams: [] })[0].scanned).toBeNull();
  });

  it("lists workspace exams newest first with readable status and period", () => {
    const rows = dashboardRows({ local: null, localScanCount: null, exams: [cloud({ _id: "a", name: "Old", createdAt: 1, status: "closed", examPeriod: "PRELIM" }), cloud({ _id: "b", name: "New", createdAt: 9, status: "draft", examPeriod: null })] });
    expect(rows.map((r) => [r.name, r.where, r.status, r.period])).toEqual([["New", "Workspace", "Draft", null], ["Old", "Workspace", "Closed", "Prelim"]]);
  });

  it("scanned is unknown (null) for workspace exams the device has no scans for", () => {
    expect(dashboardRows({ local: null, localScanCount: null, exams: [cloud()] })[0].scanned).toBeNull();
  });

  it("merges the device sheet into its workspace exam when the layout matches (one row, device scan count)", () => {
    const rows = dashboardRows({ local: { title: "Midterm", layoutHash: "AAA" }, localScanCount: 7, exams: [cloud()] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Midterm", where: "Workspace", scanned: 7, key: "e1" });
  });

  it("puts a device-only draft first, ahead of workspace exams", () => {
    const rows = dashboardRows({ local, localScanCount: 0, exams: [cloud()] });
    expect(rows.map((r) => r.name)).toEqual(["Quiz 1", "Midterm"]);
  });

  it("caps the list", () => {
    const exams = Array.from({ length: 12 }, (_, i) => cloud({ _id: `e${i}`, layoutHash: `H${i}`, createdAt: i }));
    expect(dashboardRows({ local: null, localScanCount: null, exams }, 5)).toHaveLength(5);
  });

  it("falls back to the template id when the local title is blank", () => {
    expect(dashboardRows({ local: { title: "  ", layoutHash: "L", templateId: "tpl-1" }, localScanCount: null, exams: [] })[0].name).toBe("tpl-1");
  });
});

describe("atAGlance", () => {
  it("returns plain-label tiles in order", () => {
    expect(atAGlance({ exams: [], localScanCount: 0 }).map((t) => t.label)).toEqual(["Examinations", "Sheets scanned on this device", "Syllabi", "Pending access"]);
  });

  it("counts every distinct exam, including a device-only draft", () => {
    const t = atAGlance({ exams: [cloud()], local, localScanCount: 3 });
    expect(t.find((x) => x.id === "exams")?.value).toBe(2);
    expect(atAGlance({ exams: [cloud()], local: { title: "M", layoutHash: "AAA" }, localScanCount: 3 }).find((x) => x.id === "exams")?.value).toBe(1);
  });

  it("keeps unknown values null (never 0): exams still loading, scans not read yet, syllabi/pending not available", () => {
    const t = atAGlance({ exams: undefined, localScanCount: null });
    expect(t.map((x) => x.value)).toEqual([null, null, null, null]);
  });

  it("passes real syllabi and pending counts through, and a loaded zero stays 0", () => {
    const t = atAGlance({ exams: [], localScanCount: 0, syllabi: 4, pending: 0 });
    expect(t.map((x) => x.value)).toEqual([0, 0, 4, 0]);
  });

  it("only offers Pending access to admins (hidden when the count is not provided as a number)", () => {
    expect(atAGlance({ exams: [], localScanCount: 0 }).find((x) => x.id === "pending")?.available).toBe(false);
    expect(atAGlance({ exams: [], localScanCount: 0, pending: 2 }).find((x) => x.id === "pending")?.available).toBe(true);
  });
});
