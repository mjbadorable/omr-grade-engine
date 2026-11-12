// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** One institution: the shared University of San Agustin workspace is provisioned and joined automatically. */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { DEFAULT_ORG_NAME, parseAutoJoin } from "@/lib/institution";

const modules = import.meta.glob("../../convex/**/*.ts");
const as = (t: ReturnType<typeof convexTest>, id: string) => t.withIdentity({ subject: id, name: id, email: `${id}@usa.edu.ph`, emailVerified: true });
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };

afterEach(() => { delete process.env.DEFAULT_ADMIN_EMAILS; delete process.env.OMR_AUTO_JOIN; });

describe("ensureDefault workspace", () => {
  it("creates the USA workspace on first call and joins every later faculty member as a teacher; idempotent", async () => {
    const t = convexTest(schema, modules);
    const ana = as(t, "ana"), ben = as(t, "ben");
    await ana.mutation(api.users.store, {}); await ben.mutation(api.users.store, {});
    const a = await ana.mutation(api.orgs.ensureDefault, {});
    expect(a.role).toBe("teacher");
    const b = await ben.mutation(api.orgs.ensureDefault, {});
    expect(b.orgId).toBe(a.orgId);
    expect(await ana.mutation(api.orgs.ensureDefault, {})).toEqual(a);                // idempotent
    const mine = await ana.query(api.orgs.listMine, {});
    expect(mine).toEqual([{ _id: a.orgId, name: DEFAULT_ORG_NAME, role: "teacher" }]);
    expect(await code(ana.query(api.admin.listFaculty, { orgId: a.orgId }))).toBe("FORBIDDEN");
  });

  it("a DEFAULT_ADMIN_EMAILS user who arrives first owns the workspace; later admins become admin", async () => {
    process.env.DEFAULT_ADMIN_EMAILS = "dean@usa.edu.ph, staff@usa.edu.ph";
    const t = convexTest(schema, modules);
    const dean = as(t, "dean"), staff = as(t, "staff"), ana = as(t, "ana");
    for (const u of [dean, staff, ana]) await u.mutation(api.users.store, {});
    expect((await dean.mutation(api.orgs.ensureDefault, {})).role).toBe("owner");
    expect((await staff.mutation(api.orgs.ensureDefault, {})).role).toBe("admin");
    expect((await ana.mutation(api.orgs.ensureDefault, {})).role).toBe("teacher");
    const { orgId } = await dean.mutation(api.orgs.ensureDefault, {});
    expect((await dean.query(api.admin.listFaculty, { orgId })).map((r) => `${r.email}:${r.role}`)).toEqual(["dean@usa.edu.ph:owner", "staff@usa.edu.ph:admin", "ana@usa.edu.ph:teacher"]);
  });

  it("a teacher arriving first does not become owner; an admin who signs in later is still admin", async () => {
    process.env.DEFAULT_ADMIN_EMAILS = "dean@usa.edu.ph";
    const t = convexTest(schema, modules);
    const ana = as(t, "ana"), dean = as(t, "dean");
    await ana.mutation(api.users.store, {}); await dean.mutation(api.users.store, {});
    expect((await ana.mutation(api.orgs.ensureDefault, {})).role).toBe("teacher");
    expect((await dean.mutation(api.orgs.ensureDefault, {})).role).toBe("admin");
  });

  it("OMR_AUTO_JOIN=off leaves new faculty without a role until an admin adds them; =viewer gives read-only", async () => {
    process.env.OMR_AUTO_JOIN = "off";
    const t = convexTest(schema, modules);
    const ana = as(t, "ana"); await ana.mutation(api.users.store, {});
    expect(await ana.mutation(api.orgs.ensureDefault, {})).toMatchObject({ role: null });
    process.env.OMR_AUTO_JOIN = "viewer";
    expect(await ana.mutation(api.orgs.ensureDefault, {})).toMatchObject({ role: "viewer" });
  });

  it("outside accounts cannot provision or join anything", async () => {
    const t = convexTest(schema, modules);
    expect(await code(t.withIdentity({ subject: "x", email: "x@gmail.com", emailVerified: true }).mutation(api.orgs.ensureDefault, {}))).toBe("DOMAIN_NOT_ALLOWED");
    expect(await code(t.mutation(api.orgs.ensureDefault, {}))).toBe("UNAUTHENTICATED");
  });

  it("parses the auto-join setting", () => {
    expect([undefined, "", "teacher", "VIEWER", " off ", "admin"].map(parseAutoJoin)).toEqual(["teacher", "teacher", "teacher", "viewer", "off", "teacher"]);
  });
});
