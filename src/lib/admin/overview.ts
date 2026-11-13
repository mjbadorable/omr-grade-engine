import { ADMIN_VIEWS, type AdminView, shellNav } from "@/lib/shell-nav";

/** Admin overview tiles from real query results. A query still loading is `undefined` and shows as null (never 0). */
export interface OverviewTile { id: "faculty" | "pending" | "syllabi" | "exams"; label: string; value: number | null; warn: boolean }

export function adminOverview(i: { faculty?: readonly unknown[]; pending?: number; syllabi?: readonly unknown[]; exams?: readonly unknown[] }): OverviewTile[] {
  return [
    { id: "faculty", label: "Faculty Accounts", value: i.faculty?.length ?? null, warn: false },
    { id: "pending", label: "Pending Access", value: i.pending ?? null, warn: (i.pending ?? 0) > 0 },
    { id: "syllabi", label: "Syllabi", value: i.syllabi?.length ?? null, warn: false },
    { id: "exams", label: "Examinations", value: i.exams?.length ?? null, warn: false },
  ];
}

export interface AdminModule { view: Exclude<AdminView, "overview">; label: string; href: string; description: string; /** real count for the area, or null (still loading / not countable) */ count: number | null }

const MODULE_TEXT: Record<AdminModule["view"], string> = {
  faculty: "See who has access and change a person's role.",
  access: "Approve access requests and pre-authorize faculty by email.",
  syllabi: "Browse the syllabi faculty have added to the school.",
  audit: "Search key changes, grade corrections and admin actions.",
  policy: "Set the school grading formula and the allowed email domains.",
};

/** "System Modules" cards: the five management areas with their real counts. */
export function adminModules(i: { faculty?: readonly unknown[]; pending?: number; syllabi?: readonly unknown[]; auditTotal?: number }): AdminModule[] {
  const counts: Record<AdminModule["view"], number | null> = {
    faculty: i.faculty?.length ?? null, access: i.pending ?? null, syllabi: i.syllabi?.length ?? null, audit: i.auditTotal ?? null, policy: null,
  };
  return (shellNav("admin").admin ?? []).filter((a): a is typeof a & { view: AdminModule["view"] } => (ADMIN_VIEWS as readonly string[]).includes(a.view) && a.view !== "overview")
    .map((a) => ({ view: a.view, label: a.label, href: a.href, description: MODULE_TEXT[a.view], count: counts[a.view] }));
}
