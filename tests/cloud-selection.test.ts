import { describe, expect, it } from "vitest";
import { resolveCloudSelection } from "@/lib/cloud/selection";

describe("resolveCloudSelection", () => {
  it("suppresses stale orgId and examId until defaultOrg and exams confirm they exist", () => {
    const stale = { orgId: "org-old", examId: "exam-deleted", layoutHash: "h1" };

    // Before defaultOrg loads: both orgId and examId are gated off
    expect(resolveCloudSelection({ ready: true, defaultOrgId: null, selection: stale, exams: undefined })).toEqual({
      orgId: null,
      examId: null,
      layoutHash: null,
    });

    // After defaultOrg loads, before exams loads: orgId matches defaultOrg, examId still gated off
    expect(resolveCloudSelection({ ready: true, defaultOrgId: "org-live", selection: stale, exams: undefined })).toEqual({
      orgId: "org-live",
      examId: null,
      layoutHash: null,
    });

    // After exams loads and does NOT contain exam-deleted: examId stays null
    expect(resolveCloudSelection({
      ready: true,
      defaultOrgId: "org-live",
      selection: stale,
      exams: [{ _id: "exam-1", layoutHash: "h2" }],
    })).toEqual({
      orgId: "org-live",
      examId: null,
      layoutHash: null,
    });

    // When exams DOES contain the selected exam: returns it
    expect(resolveCloudSelection({
      ready: true,
      defaultOrgId: "org-live",
      selection: { orgId: "org-live", examId: "exam-1", layoutHash: "h2" },
      exams: [{ _id: "exam-1", layoutHash: "h2" }],
    })).toEqual({
      orgId: "org-live",
      examId: "exam-1",
      layoutHash: "h2",
    });
  });
});
