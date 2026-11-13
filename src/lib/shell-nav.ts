/** Navigation model for the left rail, top-bar breadcrumb and the ?view= / ?tab= query values (pure). */
import { isAdmin, type Role } from "@/lib/roles/policy";

export type NavId = "dashboard" | "design" | "scan" | "grade" | "reports" | "admin";
export interface NavItem { id: NavId; label: string; href: string }

export const ADMIN_VIEWS = ["overview", "faculty", "access", "syllabi", "audit", "policy"] as const;
export type AdminView = (typeof ADMIN_VIEWS)[number];
export interface AdminLink { view: AdminView; label: string; href: string }

export const GRADE_TABS = ["key", "gradebook", "roster", "analysis", "outcomes"] as const;
export type GradeTab = (typeof GRADE_TABS)[number];

const MAIN: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/" },
  { id: "design", label: "Design Exam", href: "/designer" },
  { id: "scan", label: "Scan & Upload", href: "/scan" },
  { id: "grade", label: "Gradebook", href: "/grade" },
  { id: "reports", label: "Reports", href: "/grade?tab=analysis" },
];
const ADMIN_LABEL: Record<AdminView, string> = {
  overview: "Overview", faculty: "Faculty Management", access: "User Access & Roles", syllabi: "Syllabi Management", audit: "Audit Trail", policy: "Policy & Grading",
};
const ADMIN: AdminLink[] = ADMIN_VIEWS.map((view) => ({ view, label: ADMIN_LABEL[view], href: `/admin?view=${view}` }));

/** Rail items for a role: Administration (with sub-links) only for admins and owners. */
export function shellNav(role: Role | null | undefined): { main: NavItem[]; admin: AdminLink[] | null } {
  return { main: MAIN, admin: isAdmin(role) ? ADMIN : null };
}

export const parseAdminView = (v: string | null | undefined): AdminView => ((ADMIN_VIEWS as readonly string[]).includes(v ?? "") ? (v as AdminView) : "overview");
export const parseGradeTab = (v: string | null | undefined): GradeTab | null => ((GRADE_TABS as readonly string[]).includes(v ?? "") ? (v as GradeTab) : null);

const norm = (path: string | null | undefined) => (path && path.length > 1 ? path.replace(/\/+$/, "") : path ?? "");
const param = (search: string | undefined, key: string) => new URLSearchParams(search ?? "").get(key);

export function activeNav(path: string | null | undefined, search?: string): NavId | null {
  const p = norm(path);
  if (p === "/") return "dashboard";
  if (p.startsWith("/designer")) return "design";
  if (p.startsWith("/scan")) return "scan";
  if (p.startsWith("/admin")) return "admin";
  if (p.startsWith("/grade")) {
    const tab = parseGradeTab(param(search, "tab"));
    return tab === "analysis" || tab === "outcomes" ? "reports" : "grade";
  }
  return null;
}

export function breadcrumb(path: string | null | undefined, search?: string): string[] {
  const id = activeNav(path, search);
  if (!id) return [];
  if (id === "admin") return ["Administration", ADMIN_LABEL[parseAdminView(param(search, "view"))]];
  return [MAIN.find((n) => n.id === id)!.label];
}
