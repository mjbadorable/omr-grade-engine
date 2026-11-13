/** Teacher-facing view of the scan queue: plain states and counts (no engine telemetry). */
export interface QueueJob {
  status: "queued" | "scanning" | "done" | "error";
  /** only the flagged-answer count matters here */
  result?: { fields: { conflicts: readonly unknown[] } };
  /** calibration runs are never saved to the gradebook */
  calibration?: boolean;
}
export type QueueStateId = "queued" | "scanning" | "needs-review" | "done" | "failed";

export function queueState(job: QueueJob): { state: QueueStateId; label: string } {
  if (job.status === "queued") return { state: "queued", label: "Waiting" };
  if (job.status === "scanning") return { state: "scanning", label: "Scanning" };
  if (job.status === "error") return { state: "failed", label: "Couldn't read" };
  if ((job.result?.fields.conflicts.length ?? 0) > 0) return { state: "needs-review", label: "Needs review" };
  return { state: "done", label: "Done" };
}

export interface QueueSummary { queued: number; scanning: number; needsReview: number; done: number; failed: number; scanned: number; canProceed: boolean }

export function queueSummary(jobs: readonly QueueJob[]): QueueSummary {
  const s: QueueSummary = { queued: 0, scanning: 0, needsReview: 0, done: 0, failed: 0, scanned: 0, canProceed: false };
  for (const j of jobs) {
    if (j.calibration) continue;
    const { state } = queueState(j);
    if (state === "queued") s.queued++;
    else if (state === "scanning") s.scanning++;
    else if (state === "needs-review") s.needsReview++;
    else if (state === "done") s.done++;
    else s.failed++;
  }
  s.scanned = s.done + s.needsReview;
  s.canProceed = s.scanned > 0 && s.queued === 0 && s.scanning === 0;
  return s;
}
