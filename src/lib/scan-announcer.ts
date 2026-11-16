/**
 * Screen-reader announcement formatter (pure) for /scan aria-live="polite".
 */
export type ScanAnnouncementInput =
  | { status: "done"; rollNumber: string | null; studentName: string | null; scoreText: string | null; flaggedCount: number; calibration?: boolean }
  | { status: "error"; errorMessage?: string };

export function formatScanAnnouncement(input: ScanAnnouncementInput): string {
  if (input.status === "error") {
    return `Scan failed: ${input.errorMessage?.trim() || "Could not read sheet."}`;
  }
  const who = [
    input.rollNumber ? `Roll ${input.rollNumber}` : "Roll unreadable",
    input.studentName ? input.studentName : null,
  ].filter(Boolean).join(", ");
  const score = input.scoreText ? `, score ${input.scoreText}` : "";
  const flags = input.flaggedCount > 0 ? `, ${input.flaggedCount} flagged for review` : "";
  const prefix = input.calibration ? "Calibration scan complete" : "Scan complete";
  return `${prefix}: ${who}${score}${flags}.`;
}
