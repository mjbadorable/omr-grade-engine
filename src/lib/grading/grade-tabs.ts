/** Sub-tabs of the Gradebook & Reports workspace (pure). Tab ids stay the existing ones so deep links keep working. */
import type { GradeTab } from "@/lib/shell-nav";

export interface GradeTabInfo { id: GradeTab; label: string; /** small badge text, or null */ count: string | null; /** true = needs the teacher's attention */ warn: boolean }

/**
 * Things to look at in Review Exceptions. Without an imported roster every scanned sheet would
 * look "not on the roster", so then only unresolved conflicts and unreadable roll numbers count.
 */
export function exceptionsCount(i: { openConflicts: number; hasRoster: boolean; absent: number; unregistered: number; unreadable: number }): number {
  return i.openConflicts + i.unreadable + (i.hasRoster ? i.absent + i.unregistered : 0);
}

export function gradeTabs(i: { keyed: number; total: number; sheets: number; exceptions: number; belowTarget: number }): GradeTabInfo[] {
  return [
    { id: "gradebook", label: "Results", count: String(i.sheets), warn: false },
    { id: "key", label: "Answer Key", count: `${i.keyed} / ${i.total}`, warn: i.keyed < i.total },
    { id: "roster", label: "Review Exceptions", count: i.exceptions > 0 ? String(i.exceptions) : null, warn: i.exceptions > 0 },
    { id: "analysis", label: "Item Analysis", count: null, warn: false },
    { id: "outcomes", label: "OBE Outcomes", count: i.belowTarget > 0 ? `${i.belowTarget} below target` : null, warn: i.belowTarget > 0 },
  ];
}
