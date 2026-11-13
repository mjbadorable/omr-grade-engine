import { describe, expect, it } from "vitest";
import { queueState, queueSummary, type QueueJob } from "@/lib/scan-queue";

const job = (over: Partial<QueueJob> = {}): QueueJob => ({ status: "done", result: { fields: { conflicts: [] } }, ...over });
const review = () => job({ result: { fields: { conflicts: [{}, {}] } } });

describe("queueState", () => {
  it("maps each job status to a teacher-friendly state and label", () => {
    expect(queueState({ status: "queued" })).toEqual({ state: "queued", label: "Waiting" });
    expect(queueState({ status: "scanning" })).toEqual({ state: "scanning", label: "Scanning" });
    expect(queueState(job())).toEqual({ state: "done", label: "Done" });
    expect(queueState({ status: "error" })).toEqual({ state: "failed", label: "Couldn't read" });
  });

  it("treats a finished scan with flagged answers as needing review", () => {
    expect(queueState(review())).toEqual({ state: "needs-review", label: "Needs review" });
  });

  it("is done (not needs-review) when a finished job has no result yet", () => {
    expect(queueState({ status: "done" }).state).toBe("done");
  });
});

describe("queueSummary", () => {
  it("is empty and cannot proceed with no jobs", () => {
    expect(queueSummary([])).toEqual({ queued: 0, scanning: 0, needsReview: 0, done: 0, failed: 0, scanned: 0, canProceed: false });
  });

  it("counts each state and the sheets saved for grading", () => {
    const s = queueSummary([job(), job(), review(), { status: "error" }]);
    expect(s).toMatchObject({ done: 2, needsReview: 1, failed: 1, scanned: 3 });
  });

  it("blocks Proceed to Grade while anything is still waiting or scanning", () => {
    expect(queueSummary([job(), { status: "scanning" }]).canProceed).toBe(false);
    expect(queueSummary([job(), { status: "queued" }]).canProceed).toBe(false);
  });

  it("allows Proceed to Grade once at least one sheet is scanned and nothing is pending", () => {
    expect(queueSummary([job(), review()]).canProceed).toBe(true);
    expect(queueSummary([job(), { status: "error" }]).canProceed).toBe(true);
  });

  it("does not allow Proceed to Grade when every scan failed", () => {
    expect(queueSummary([{ status: "error" }]).canProceed).toBe(false);
  });

  it("ignores calibration runs: they are never saved to the gradebook", () => {
    const s = queueSummary([job({ calibration: true }), { status: "scanning", calibration: true }]);
    expect(s).toMatchObject({ done: 0, scanning: 0, scanned: 0, canProceed: false });
  });
});
