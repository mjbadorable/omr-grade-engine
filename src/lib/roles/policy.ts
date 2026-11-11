/**
 * Institutional role hierarchy (pure, shared by Convex functions and the UI).
 *
 *   admin   : EdTech staff / supervisors / deans - governance: faculty roles, domain allowlist,
 *             grading formulas, cross-section audit, plus everything a teacher can do.
 *   teacher : faculty instructors - syllabus drop, exams, keys, scanning, roster, cohort analytics.
 *   viewer  : read-only (e.g. an observer or a co-teacher awaiting access).
 *   owner   : the user who created the school; an admin who cannot be demoted by anyone else.
 *
 * Ranks are ordered, so "needs teacher" is satisfied by admin and owner as well.
 */
export const ROLES = ["viewer", "teacher", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
export const RANK: Record<Role, number> = { viewer: 0, teacher: 1, admin: 2, owner: 3 };

export const ACTIONS = {
  // faculty
  "analytics.view": "viewer",
  "syllabus.view": "viewer",
  "syllabus.drop": "teacher",
  "exam.create": "teacher",
  "key.edit": "teacher",
  "scan.submit": "teacher",
  "grade.override": "teacher",
  "conflict.resolve": "teacher",
  "roster.import": "teacher",
  // governance
  "admin.portal": "admin",
  "syllabus.delete": "admin",
  "faculty.manage": "admin",
  "policy.edit": "admin",
  "audit.view": "admin",
  "exam.close": "admin",
} as const satisfies Record<string, Role>;
export type Action = keyof typeof ACTIONS;

export const isRole = (x: unknown): x is Role => typeof x === "string" && (ROLES as readonly string[]).includes(x);
export const atLeast = (role: Role | null | undefined, min: Role) => !!role && RANK[role] >= RANK[min];
export const can = (role: Role | null | undefined, action: Action) => atLeast(role, ACTIONS[action]);
/** Governance access: the /admin portal and everything behind it. */
export const isAdmin = (role: Role | null | undefined) => atLeast(role, "admin");

export type RoleChangeDecision = { ok: true } | { ok: false; code: "FORBIDDEN" | "SELF_CHANGE" | "OWNER_PROTECTED" | "INVALID_ROLE"; message: string };

/**
 * May `actor` change `target` to `next`? Rules:
 *  - only admins/owners manage roles;
 *  - nobody changes their own role (prevents accidental lock-out and self-elevation);
 *  - the owner's role is fixed and `owner` cannot be granted through the directory;
 *  - the directory moves people between viewer / teacher / admin.
 */
export function checkRoleChange(input: { actor: Role; actorId: string; target: Role; targetId: string; next: Role }): RoleChangeDecision {
  if (!can(input.actor, "faculty.manage")) return { ok: false, code: "FORBIDDEN", message: "Only admins can change faculty roles." };
  if (input.actorId === input.targetId) return { ok: false, code: "SELF_CHANGE", message: "You cannot change your own role." };
  if (input.target === "owner") return { ok: false, code: "OWNER_PROTECTED", message: "The school owner's role cannot be changed." };
  if (input.next === "owner" || !isRole(input.next)) return { ok: false, code: "INVALID_ROLE", message: "Roles can be set to viewer, teacher or admin." };
  return { ok: true };
}
