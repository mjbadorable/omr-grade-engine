import { describe, expect, it } from "vitest";
import { syncBadge } from "@/lib/sync/sync-status";

describe("syncBadge", () => {
  it("offline with queued work → 'Saved Offline · Queued for Sync (N)'", () => {
    expect(syncBadge({ online: false, pending: 3, failed: 0, draining: false })).toEqual({ tone: "offline", label: "Saved Offline · Queued for Sync (3)" });
  });
  it("offline with nothing queued says changes will be queued", () => {
    expect(syncBadge({ online: false, pending: 0, failed: 0, draining: false }).label).toMatch(/Offline/);
  });
  it("back online: syncing while draining, then 'All Changes Synced'", () => {
    expect(syncBadge({ online: true, pending: 3, failed: 0, draining: true })).toEqual({ tone: "syncing", label: "Syncing… (3)" });
    expect(syncBadge({ online: true, pending: 2, failed: 0, draining: false }).label).toBe("Queued for Sync (2)");
    expect(syncBadge({ online: true, pending: 0, failed: 0, draining: false })).toEqual({ tone: "synced", label: "All Changes Synced" });
  });
  it("refused changes are surfaced instead of being reported as synced", () => {
    expect(syncBadge({ online: true, pending: 0, failed: 2, draining: false })).toEqual({ tone: "attention", label: "2 changes need attention" });
  });
});
