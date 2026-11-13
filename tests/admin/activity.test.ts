import { describe, expect, it } from "vitest";
import { recentActivity, type ActivityRow } from "@/lib/admin/activity";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({ id: "a", at: 1000, actorName: "Ana Cruz", actorEmail: "ana@usa.edu.ph", label: "Answer key", summary: "Answer key v2: Q3 changed", examName: "Midterm", ...over });

describe("recentActivity", () => {
  it("is null while the audit trail is still loading", () => {
    expect(recentActivity(undefined)).toBeNull();
  });

  it("is an empty list when there is no activity yet", () => {
    expect(recentActivity([])).toEqual([]);
  });

  it("shows who did what, on which exam, newest first", () => {
    const items = recentActivity([row({ id: "old", at: 1 }), row({ id: "new", at: 9, summary: "Q1 corrected", examName: undefined })])!;
    expect(items.map((i) => i.id)).toEqual(["new", "old"]);
    expect(items[0]).toMatchObject({ who: "Ana Cruz", what: "Q1 corrected", exam: null, at: 9, kind: "Answer key" });
    expect(items[1].exam).toBe("Midterm");
  });

  it("falls back to the email when the name is blank, then to a neutral label (never an invented person)", () => {
    expect(recentActivity([row({ actorName: "" })])![0].who).toBe("ana@usa.edu.ph");
    expect(recentActivity([row({ actorName: "  ", actorEmail: "" })])![0].who).toBe("Unknown user");
  });

  it("caps the feed", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `r${i}`, at: i }));
    expect(recentActivity(rows, 4)).toHaveLength(4);
    expect(recentActivity(rows)).toHaveLength(6);
  });
});
