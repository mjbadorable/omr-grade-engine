// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * The public Convex surface is exactly what the browser may call. Anything backend-only must be an
 * internal function. This guard fails when a function becomes public (or a new one appears) without
 * being listed here on purpose.
 */
import { describe, expect, it } from "vitest";

const mods = import.meta.glob("../../convex/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;
type Registered = { isPublic?: boolean; isInternal?: boolean };

const publicFunctions = () => {
  const out: string[] = [];
  for (const [path, mod] of Object.entries(mods)) {
    const file = path.split("/").pop()!.replace(/\.ts$/, "");
    for (const [name, fn] of Object.entries(mod)) if ((fn as Registered)?.isPublic) out.push(`${file}.${name}`);
  }
  return out.sort();
};

describe("public Convex surface", () => {
  it("does not expose orgs.create: creating a school is a backend-only action", () => {
    const create = mods["../../convex/orgs.ts"].create as Registered;
    expect(create.isInternal).toBe(true);
    expect(create.isPublic).toBeFalsy();
  });

  it("keeps the analytics jobs internal", () => {
    for (const name of ["examState", "scanPage", "recompute", "storeSnapshot"]) {
      expect((mods["../../convex/analytics.ts"][name] as Registered).isInternal).toBe(true);
    }
  });

  it("lists exactly the functions the app calls from the browser", () => {
    expect(publicFunctions()).toEqual([
      "admin.auditTrail", "admin.decideRequest", "admin.getPolicy", "admin.listAccess", "admin.listFaculty", "admin.pendingCount", "admin.preAuthorize", "admin.revokePreAuthorization", "admin.setPolicy", "admin.setRole",
      "examFolders.create", "examFolders.listByOrg", "examFolders.remove", "examFolders.rename",
      "exams.archive", "exams.bindSyllabus", "exams.create", "exams.duplicate", "exams.get", "exams.getRoster", "exams.listByOrg", "exams.remove", "exams.setFolder", "exams.setRoster", "exams.setStatus",
      "grading.addOverrides", "grading.generateUploadUrl", "grading.getAnswerKey", "grading.getExamAnalytics", "grading.getScan", "grading.listKeyVersions", "grading.listOverrides", "grading.listResolutions", "grading.listScans", "grading.resolveConflict", "grading.submitScanBatch", "grading.updateAnswerKey",
      "orgs.addMember", "orgs.ensureDefault", "orgs.listMine", "orgs.myAccess", "orgs.requestAccess",
      "syllabi.get", "syllabi.listByOrg", "syllabi.remove", "syllabi.upsert",
      "users.accessStatus", "users.me", "users.store",
    ]);
  });
});
