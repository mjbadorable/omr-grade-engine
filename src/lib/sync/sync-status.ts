/** What the header badge says, as a pure function of the outbox state (unit-tested). */
export type SyncTone = "synced" | "syncing" | "offline" | "attention";
export interface SyncBadgeView { tone: SyncTone; label: string }

export function syncBadge(s: { online: boolean; pending: number; failed: number; draining: boolean }): SyncBadgeView {
  if (!s.online) return s.pending > 0
    ? { tone: "offline", label: `Saved Offline · Queued for Sync (${s.pending})` }
    : { tone: "offline", label: "Offline · changes will be queued" };
  if (s.pending > 0) return { tone: "syncing", label: s.draining ? `Syncing… (${s.pending})` : `Queued for Sync (${s.pending})` };
  if (s.failed > 0) return { tone: "attention", label: `${s.failed} change${s.failed > 1 ? "s" : ""} need attention` };
  return { tone: "synced", label: "All Changes Synced" };
}
