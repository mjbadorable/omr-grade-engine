/** Admin overview tiles from real query results. A query still loading is `undefined` and shows as null (never 0). */
export interface OverviewTile { id: "faculty" | "pending" | "syllabi" | "exams"; label: string; value: number | null; warn: boolean }

export function adminOverview(i: { faculty?: readonly unknown[]; pending?: number; syllabi?: readonly unknown[]; exams?: readonly unknown[] }): OverviewTile[] {
  return [
    { id: "faculty", label: "Faculty", value: i.faculty?.length ?? null, warn: false },
    { id: "pending", label: "Pending Access", value: i.pending ?? null, warn: (i.pending ?? 0) > 0 },
    { id: "syllabi", label: "Syllabi", value: i.syllabi?.length ?? null, warn: false },
    { id: "exams", label: "Examinations", value: i.exams?.length ?? null, warn: false },
  ];
}
