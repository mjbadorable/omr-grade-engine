/**
 * Audit trail: one flat, searchable list built from the append-only records (answer-key versions,
 * grade overrides, conflict resolutions) plus admin events (role changes, policy, syllabi).
 */
export const AUDIT_KINDS = ["KEY_UPDATE", "GRADE_OVERRIDE", "CONFLICT_RESOLUTION", "ROLE_CHANGE", "POLICY_CHANGE", "SYLLABUS_UPLOAD", "SYLLABUS_DELETE"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_LABEL: Record<AuditKind, string> = {
  KEY_UPDATE: "Answer key update",
  GRADE_OVERRIDE: "Grade override",
  CONFLICT_RESOLUTION: "Conflict resolution",
  ROLE_CHANGE: "Role change",
  POLICY_CHANGE: "Policy change",
  SYLLABUS_UPLOAD: "Syllabus upload",
  SYLLABUS_DELETE: "Syllabus removed",
};

export interface AuditEntry {
  id: string;
  at: number;
  kind: AuditKind;
  actorId: string;
  actorName: string;
  actorEmail: string;
  /** exam the action belongs to (cross-section audits filter by it) */
  examName?: string;
  summary: string;
  detail?: string;
}

export interface AuditFilter { query?: string; kinds?: readonly AuditKind[]; actor?: string; from?: number; to?: number }

/** Newest first; case-insensitive AND-match of every word in `query` against the entry's text. */
export function searchAudit(entries: readonly AuditEntry[], f: AuditFilter = {}): AuditEntry[] {
  const words = (f.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const kinds = f.kinds?.length ? new Set<AuditKind>(f.kinds) : null;
  return entries
    .filter((e) => {
      if (kinds && !kinds.has(e.kind)) return false;
      if (f.actor && e.actorId !== f.actor) return false;
      if (f.from !== undefined && e.at < f.from) return false;
      if (f.to !== undefined && e.at > f.to) return false;
      if (!words.length) return true;
      const hay = `${AUDIT_LABEL[e.kind]} ${e.actorName} ${e.actorEmail} ${e.examName ?? ""} ${e.summary} ${e.detail ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

interface KeyRuleLike {
  type: string;
  points: number;
  negative: number;
  bonus: boolean;
  dropped: boolean;
  correct?: number[];
  optionLabels?: string[];
  value?: number | null;
  outcomeCode?: string;
}
interface KeyBodyLike { questions: Record<string, KeyRuleLike> }

const answerText = (r: KeyRuleLike): string => {
  if (r.type === "choice") return (r.correct ?? []).map((i) => r.optionLabels?.[i] ?? String(i + 1)).join("") || "(none)";
  if (r.type === "numeric") return r.value === null || r.value === undefined ? "(none)" : String(r.value);
  return "matrix";
};

/** "Q5 answer B→C; Q7 points 1→2" — what changed between two key versions. */
export function describeKeyChange(prev: KeyBodyLike | null, next: KeyBodyLike, maxItems = 6): string {
  if (!prev) return "Initial answer key created";
  const parts: string[] = [];
  for (const n of Object.keys(next.questions).sort((a, b) => Number(a) - Number(b))) {
    const a = prev.questions[n], b = next.questions[n];
    if (!a || !b) continue;
    if (answerText(a) !== answerText(b)) parts.push(`Q${n} answer ${answerText(a)}→${answerText(b)}`);
    if (a.points !== b.points) parts.push(`Q${n} points ${a.points}→${b.points}`);
    if (a.negative !== b.negative) parts.push(`Q${n} penalty ${a.negative}→${b.negative}`);
    if (a.bonus !== b.bonus) parts.push(`Q${n} ${b.bonus ? "marked bonus" : "bonus removed"}`);
    if (a.dropped !== b.dropped) parts.push(`Q${n} ${b.dropped ? "dropped" : "restored"}`);
    if ((a.outcomeCode ?? "") !== (b.outcomeCode ?? "")) parts.push(`Q${n} outcome ${a.outcomeCode ?? "-"}→${b.outcomeCode ?? "-"}`);
  }
  if (!parts.length) return "Key settings updated (grade bands / sets / policy)";
  return parts.length > maxItems ? `${parts.slice(0, maxItems).join("; ")}; +${parts.length - maxItems} more` : parts.join("; ");
}
