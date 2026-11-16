/**
 * Live "who's missing" checklist helper for /scan (pure).
 * Reuses `reconcile` over the active exam's roster + stored scans + current session jobs.
 */
import { reconcile, type SheetRef } from "@/lib/roster/reconcile";
import { rollKey, type Roster, type Student } from "@/lib/roster/schema";

export type RollChecklistStatus = "matched" | "duplicate" | "unregistered" | "unreadable" | "missing";

export interface SessionScanRef {
  sheetId: string;
  rollNumber: string | null;
  calibration?: boolean;
}

export interface ScanRosterChecklist {
  rosterName: string;
  total: number;
  scanned: number;
  missing: Student[];
  duplicates: { rollNumber: string; name: string; count: number }[];
  unregistered: { rollNumber: string; count: number }[];
  unreadableCount: number;
  classifyRoll: (rollNumber: string | null) => RollChecklistStatus;
}

export function buildScanRosterChecklist(
  roster: Roster | null,
  storedScans: readonly SheetRef[],
  sessionScans: readonly SessionScanRef[],
): ScanRosterChecklist | null {
  if (!roster || roster.students.length === 0) return null;

  const byId = new Map<string, SheetRef>();
  for (const s of storedScans) byId.set(s.sheetId, s);
  for (const s of sessionScans) {
    if (!s.calibration) byId.set(s.sheetId, { sheetId: s.sheetId, rollNumber: s.rollNumber });
  }

  const recon = reconcile(roster, [...byId.values()]);
  const statusByKey = new Map<string, RollChecklistStatus>();
  const missing: Student[] = [];
  const duplicates: { rollNumber: string; name: string; count: number }[] = [];
  const unregistered: { rollNumber: string; count: number }[] = [];

  for (const entry of recon.entries) {
    if (entry.status === "MATCHED") {
      const st: RollChecklistStatus = entry.duplicateSheets ? "duplicate" : "matched";
      statusByKey.set(entry.key, st);
      if (entry.duplicateSheets) {
        duplicates.push({ rollNumber: entry.student.rollNumber, name: entry.student.name, count: entry.sheetIds.length });
      }
    } else if (entry.status === "ABSENT") {
      statusByKey.set(entry.key, "missing");
      missing.push(entry.student);
    } else if (entry.status === "UNREGISTERED_STUDENT") {
      statusByKey.set(entry.key, "unregistered");
      unregistered.push({ rollNumber: entry.rollNumber, count: entry.sheetIds.length });
    }
  }

  return {
    rosterName: roster.name,
    total: recon.summary.roster,
    scanned: recon.summary.matched,
    missing,
    duplicates,
    unregistered,
    unreadableCount: recon.summary.unreadable,
    classifyRoll: (rollNumber) => {
      const k = rollKey(rollNumber);
      if (!k) return "unreadable";
      return statusByKey.get(k) ?? "unregistered";
    },
  };
}
