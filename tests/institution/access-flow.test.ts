// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Students share @usa.edu.ph: nobody sees exams, keys or records without pre-authorization or approval. */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { parseEmailList } from "@/lib/access-requests";
import { buildSampleExam } from "@/lib/samples/sample-kit";

const modules = import.meta.glob("../../convex/**/*.ts");
const kit = buildSampleExam();
const as = (t: ReturnType<typeof convexTest>, id: string) => t.withIdentity({ subject: id, name: id, email: `${id}@usa.edu.ph`, emailVerified: true });
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };

afterEach(() => { delete process.env.DEFAULT_ADMIN_EMAILS; delete process.env.OMR_AUTO_JOIN; });

/** Workspace with an owner (dean), one exam with a key, and a signed-in student. */
async function setup() {
  process.env.DEFAULT_ADMIN_EMAILS = "dean@usa.edu.ph";
  const t = convexTest(schema, modules);
  const dean = as(t, "dean"), student = as(t, "student");
  await dean.mutation(api.users.store, {}); await student.mutation(api.users.store, {});
  const { orgId } = await dean.mutation(api.orgs.ensureDefault, {});
  const examId = await dean.mutation(api.exams.create, { orgId, name: "IT 321 Prelim", template: kit.template });
  return { t, dean, student, orgId, examId };
}

describe("default is closed", () => {
  it("an unapproved @usa.edu.ph account (a student) is not joined and cannot read anything", async () => {
    const { student, orgId, examId } = await setup();
    expect(await student.mutation(api.orgs.ensureDefault, {})).toEqual({ orgId, role: null });
    expect(await student.query(api.orgs.listMine, {})).toEqual([]);
    expect(await student.query(api.orgs.myAccess, {})).toEqual({ orgId, role: null, request: null });
    // thunks: each call starts only when it is awaited (no unhandled rejections)
    for (const [what, call] of [
      ["exam list", () => student.query(api.exams.listByOrg, { orgId })],
      ["exam", () => student.query(api.exams.get, { examId })],
      ["answer key", () => student.query(api.grading.getAnswerKey, { examId })],
      ["scans", () => student.query(api.grading.listScans, { examId, paginationOpts: { numItems: 5, cursor: null } })],
      ["roster", () => student.query(api.exams.getRoster, { examId })],
      ["analytics", () => student.query(api.grading.getExamAnalytics, { examId })],
      ["syllabi", () => student.query(api.syllabi.listByOrg, { orgId })],
      ["policy", () => student.query(api.admin.getPolicy, { orgId })],
      ["key update", () => student.mutation(api.grading.updateAnswerKey, { examId, baseVersion: 1, key: { questions: {}, sets: {}, defaultSet: null, gradeBands: [], conflictPolicy: "zero" } })],
      ["create exam", () => student.mutation(api.exams.create, { orgId, name: "x", template: kit.template })],
    ] as const) expect(await code(call()), what).toBe("FORBIDDEN");
  });
});

describe("pre-authorization", () => {
  it("binds a faculty email to the chosen role the moment they first sign in; the entry is consumed", async () => {
    const { t, dean, orgId } = await setup();
    const res = await dean.mutation(api.admin.preAuthorize, { orgId, emails: "Ana@usa.edu.ph,\nben@usa.edu.ph ; ana@usa.edu.ph", role: "teacher" });
    expect(res).toEqual({ bound: [], queued: ["ana@usa.edu.ph", "ben@usa.edu.ph"], unchanged: [], invalid: [] });
    expect((await dean.query(api.admin.listAccess, { orgId })).preAuthorized.map((p) => `${p.email}:${p.role}`)).toEqual(["ana@usa.edu.ph:teacher", "ben@usa.edu.ph:teacher"]);
    const ana = as(t, "ana");
    await ana.mutation(api.users.store, {});                                   // first sign-in
    expect(await ana.query(api.orgs.myAccess, {})).toMatchObject({ role: "teacher" });
    expect(await code(ana.query(api.exams.listByOrg, { orgId }))).toBe("OK");
    expect((await dean.query(api.admin.listAccess, { orgId })).preAuthorized.map((p) => p.email)).toEqual(["ben@usa.edu.ph"]);
  });

  it("can pre-authorize an Admin, and an already-registered student/user is bound immediately", async () => {
    const { dean, student, orgId } = await setup();
    const res = await dean.mutation(api.admin.preAuthorize, { orgId, emails: "student@usa.edu.ph", role: "admin" });
    expect(res.bound).toEqual(["student@usa.edu.ph"]);
    expect(await student.query(api.orgs.myAccess, {})).toMatchObject({ role: "admin" });
    expect(await code(student.query(api.admin.listFaculty, { orgId }))).toBe("OK");
  });

  it("rejects addresses outside the institutional domain; reports unchanged members; can be revoked", async () => {
    const { t, dean, orgId } = await setup();
    const res = await dean.mutation(api.admin.preAuthorize, { orgId, emails: "x@gmail.com, y@mail.usa.edu.ph, dean@usa.edu.ph, not-an-email, ok@usa.edu.ph", role: "teacher" });
    expect(res.invalid).toEqual(["x@gmail.com", "y@mail.usa.edu.ph", "not-an-email"]);
    expect(res.unchanged).toEqual(["dean@usa.edu.ph"]);                        // owner stays owner
    expect(res.queued).toEqual(["ok@usa.edu.ph"]);
    const { preAuthorized } = await dean.query(api.admin.listAccess, { orgId });
    await dean.mutation(api.admin.revokePreAuthorization, { orgId, id: preAuthorized[0]._id });
    const ok = as(t, "ok"); await ok.mutation(api.users.store, {});
    expect(await ok.query(api.orgs.myAccess, {})).toMatchObject({ role: null });
  });

  it("only admins can pre-authorize or read the queue", async () => {
    const { t, dean, student, orgId } = await setup();
    await dean.mutation(api.admin.preAuthorize, { orgId, emails: "ana@usa.edu.ph", role: "teacher" });
    const ana = as(t, "ana"); await ana.mutation(api.users.store, {});
    for (const who of [student, ana]) {
      expect(await code(who.mutation(api.admin.preAuthorize, { orgId, emails: "z@usa.edu.ph", role: "admin" }))).toBe("FORBIDDEN");
      expect(await code(who.query(api.admin.listAccess, { orgId }))).toBe("FORBIDDEN");
      expect(await code(who.query(api.admin.pendingCount, { orgId }))).toBe("FORBIDDEN");
    }
  });

  it("the grant is audited", async () => {
    const { dean, orgId } = await setup();
    await dean.mutation(api.admin.preAuthorize, { orgId, emails: "ana@usa.edu.ph", role: "teacher" });
    expect((await dean.query(api.admin.auditTrail, { orgId, query: "pre-authorized" })).total).toBeGreaterThan(0);
  });
});

describe("Request Faculty Access", () => {
  it("an unauthorized account requests access (idempotent) and appears in the admin queue", async () => {
    const { dean, student, orgId } = await setup();
    expect(await student.mutation(api.orgs.requestAccess, {})).toEqual({ status: "pending" });
    expect(await student.mutation(api.orgs.requestAccess, {})).toEqual({ status: "pending" });
    expect(await student.query(api.orgs.myAccess, {})).toMatchObject({ role: null, request: "pending" });
    const q = await dean.query(api.admin.listAccess, { orgId });
    expect(q.pending).toHaveLength(1);
    expect(q.pending[0]).toMatchObject({ email: "student@usa.edu.ph", name: "student" });
    expect(await dean.query(api.admin.pendingCount, { orgId })).toBe(1);
  });

  it("1-click approve binds the role immediately; the request leaves the queue", async () => {
    const { dean, student, orgId } = await setup();
    await student.mutation(api.orgs.requestAccess, {});
    const [r] = (await dean.query(api.admin.listAccess, { orgId })).pending;
    await dean.mutation(api.admin.decideRequest, { orgId, requestId: r._id, decision: "approve" });
    expect(await student.query(api.orgs.myAccess, {})).toMatchObject({ role: "teacher", request: "approved" });
    expect(await code(student.query(api.exams.listByOrg, { orgId }))).toBe("OK");
    expect((await dean.query(api.admin.listAccess, { orgId })).pending).toEqual([]);
    expect(await code(dean.mutation(api.admin.decideRequest, { orgId, requestId: r._id, decision: "reject" }))).toBe("ALREADY_DECIDED");
  });

  it("approve as Admin, and reject keeps the person out (they may ask again)", async () => {
    const { t, dean, student, orgId } = await setup();
    const other = as(t, "other"); await other.mutation(api.users.store, {});
    await student.mutation(api.orgs.requestAccess, {}); await other.mutation(api.orgs.requestAccess, {});
    const pending = (await dean.query(api.admin.listAccess, { orgId })).pending;
    const sReq = pending.find((p) => p.email.startsWith("student"))!, oReq = pending.find((p) => p.email.startsWith("other"))!;
    await dean.mutation(api.admin.decideRequest, { orgId, requestId: sReq._id, decision: "approve", role: "admin" });
    await dean.mutation(api.admin.decideRequest, { orgId, requestId: oReq._id, decision: "reject" });
    expect(await student.query(api.orgs.myAccess, {})).toMatchObject({ role: "admin" });
    expect(await other.query(api.orgs.myAccess, {})).toMatchObject({ role: null, request: "rejected" });
    expect(await code(other.query(api.exams.listByOrg, { orgId }))).toBe("FORBIDDEN");
    expect(await other.mutation(api.orgs.requestAccess, {})).toEqual({ status: "pending" });
  });

  it("members cannot decide requests; pre-authorizing a requester approves their request", async () => {
    const { t, dean, student, orgId } = await setup();
    await dean.mutation(api.admin.preAuthorize, { orgId, emails: "ana@usa.edu.ph", role: "teacher" });
    const ana = as(t, "ana"); await ana.mutation(api.users.store, {});
    await student.mutation(api.orgs.requestAccess, {});
    const [r] = (await dean.query(api.admin.listAccess, { orgId })).pending;
    expect(await code(ana.mutation(api.admin.decideRequest, { orgId, requestId: r._id, decision: "approve" }))).toBe("FORBIDDEN");
    await dean.mutation(api.admin.preAuthorize, { orgId, emails: "student@usa.edu.ph", role: "teacher" });
    expect(await student.query(api.orgs.myAccess, {})).toMatchObject({ role: "teacher", request: "approved" });
  });

  it("outside accounts cannot request access", async () => {
    const { t } = await setup();
    expect(await code(t.withIdentity({ subject: "g", email: "g@gmail.com", emailVerified: true }).mutation(api.orgs.requestAccess, {}))).toBe("DOMAIN_NOT_ALLOWED");
  });
});

describe("parseEmailList", () => {
  it("splits commas, semicolons and newlines, lowercases, de-duplicates and checks the domain", () => {
    expect(parseEmailList("A@usa.edu.ph,\nb@usa.edu.ph; a@usa.edu.ph  <c@usa.edu.ph>", ["usa.edu.ph"])).toEqual({ valid: ["a@usa.edu.ph", "b@usa.edu.ph", "c@usa.edu.ph"], invalid: [] });
    expect(parseEmailList("x@gmail.com, bad, d@usa.edu.ph", ["usa.edu.ph"])).toEqual({ valid: ["d@usa.edu.ph"], invalid: ["x@gmail.com", "bad"] });
    expect(parseEmailList("x@gmail.com").valid).toEqual(["x@gmail.com"]);          // no domain list: format only
    expect(parseEmailList("")).toEqual({ valid: [], invalid: [] });
  });
});
