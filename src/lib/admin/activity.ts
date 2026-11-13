/** "Recent System Activity" feed from the real audit trail (pure). Undefined input = still loading. */
export interface ActivityRow { id: string; at: number; actorName: string; actorEmail: string; label: string; summary: string; examName?: string }
export interface ActivityItem { id: string; at: number; who: string; kind: string; what: string; exam: string | null }

export function recentActivity(rows: readonly ActivityRow[] | undefined, limit = 6): ActivityItem[] | null {
  if (!rows) return null;
  return [...rows].sort((a, b) => b.at - a.at).slice(0, limit).map((r) => ({
    id: r.id, at: r.at, who: r.actorName.trim() || r.actorEmail.trim() || "Unknown user", kind: r.label, what: r.summary, exam: r.examName ?? null,
  }));
}
