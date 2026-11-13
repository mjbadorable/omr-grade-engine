// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { createOrg } from "../helpers/org";
import { DEV_AUTH_ISSUER, devIdentityBlocked, isProduction, selectAuthProviders } from "@/lib/cloud/auth-guard";
import { isDefaultAdmin, parseAdminEmails } from "@/lib/roles/bootstrap";

const modules = import.meta.glob("../../convex/**/*.ts");
const CLERK = { domain: "https://clerk.usa.example.com", applicationID: "convex" };
const DEV = { type: "customJwt", applicationID: "omr-dev", issuer: DEV_AUTH_ISSUER, jwks: "data:text/plain;base64,e30=", algorithm: "RS256" };
const raw = (...p: object[]) => JSON.stringify(p);
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };

describe("production auth guardrail", () => {
  it.each([
    [{ NODE_ENV: "production" }, true],
    [{ OMR_ENV: "production" }, true],
    [{ OMR_ENV: "production", CONVEX_CLOUD_URL: "http://127.0.0.1:3210" }, true],
    [{ CONVEX_CLOUD_URL: "https://happy-animal-123.convex.cloud" }, true],      // unknown cloud deployment fails closed
    [{}, true],
    [{ OMR_ENV: "development", CONVEX_CLOUD_URL: "https://dev-animal-1.convex.cloud" }, false],
    [{ CONVEX_CLOUD_URL: "http://127.0.0.1:3210" }, false],
    [{ CONVEX_CLOUD_URL: "http://localhost:3210" }, false],
    [{ NODE_ENV: "production", OMR_ENV: "development" }, true],               // NODE_ENV wins
  ])("%j → production=%s", (env, prod) => expect(isProduction(env)).toBe(prod));

  it("drops the dev issuer on production and keeps Clerk", () => {
    const r = selectAuthProviders({ OMR_ENV: "production", OMR_AUTH_PROVIDERS: raw(CLERK, DEV) });
    expect(r.providers).toEqual([CLERK]);
    expect(r.dropped).toEqual([DEV_AUTH_ISSUER]);
    expect(r.error).toMatch(/Blocked/);
  });
  it("production keeps only https OIDC providers; custom JWT and plain http are dropped", () => {
    const r = selectAuthProviders({ NODE_ENV: "production", OMR_AUTH_PROVIDERS: raw({ type: "customJwt", issuer: "https://x", jwks: "https://x/jwks", algorithm: "RS256", applicationID: "a" }, { domain: "http://insecure.example", applicationID: "convex" }, CLERK) });
    expect(r.providers).toEqual([CLERK]);
  });
  it("production with only the dev provider leaves nobody able to sign in (fail closed)", () => {
    expect(selectAuthProviders({ OMR_ENV: "production", OMR_AUTH_PROVIDERS: raw(DEV) }).providers).toEqual([]);
  });
  it("development deployments keep the dev provider", () => {
    const r = selectAuthProviders({ OMR_ENV: "development", OMR_AUTH_PROVIDERS: raw(DEV, CLERK) });
    expect(r.providers).toHaveLength(2);
    expect(r.dropped).toEqual([]);
  });
  it("reports malformed configuration instead of throwing", () => {
    expect(selectAuthProviders({ OMR_AUTH_PROVIDERS: "{" }).error).toMatch(/not valid JSON/);
    expect(selectAuthProviders({ OMR_AUTH_PROVIDERS: "{}" }).error).toMatch(/array/);
    expect(selectAuthProviders({}).providers).toEqual([]);
  });
  it("devIdentityBlocked only refuses the dev issuer, only in production", () => {
    expect(devIdentityBlocked(DEV_AUTH_ISSUER, { OMR_ENV: "production" })).toBe(true);
    expect(devIdentityBlocked("https://clerk.usa.example.com", { OMR_ENV: "production" })).toBe(false);
    expect(devIdentityBlocked(DEV_AUTH_ISSUER, { OMR_ENV: "development" })).toBe(false);
  });
});

describe("backend refuses dev-issued tokens in production", () => {
  afterEach(() => { delete process.env.OMR_ENV; });
  it("a token from the dev issuer cannot use any function when OMR_ENV=production", async () => {
    process.env.OMR_ENV = "production";
    const t = convexTest(schema, modules);
    const dev = t.withIdentity({ subject: "d", issuer: DEV_AUTH_ISSUER, email: "d@usa.edu.ph", emailVerified: true });
    expect(await code(dev.mutation(api.users.store, {}))).toBe("DEV_AUTH_DISABLED");
    expect(await code(dev.query(api.orgs.listMine, {}))).toBe("DEV_AUTH_DISABLED");
    expect(await dev.query(api.users.accessStatus, {})).toMatchObject({ signedIn: true, allowed: false, code: "DEV_AUTH_DISABLED" });
    const clerk = t.withIdentity({ subject: "c", issuer: "https://clerk.usa.example.com", email: "c@usa.edu.ph", emailVerified: true });
    expect(await code(clerk.mutation(api.users.store, {}))).toBe("OK");
  });
  it("the same token works on a development deployment", async () => {
    process.env.OMR_ENV = "development";
    const t = convexTest(schema, modules);
    expect(await code(t.withIdentity({ subject: "d", issuer: DEV_AUTH_ISSUER, email: "d@usa.edu.ph", emailVerified: true }).mutation(api.users.store, {}))).toBe("OK");
  });
});

describe("DEFAULT_ADMIN_EMAILS", () => {
  afterEach(() => { delete process.env.DEFAULT_ADMIN_EMAILS; });
  it("parses lists", () => {
    expect(parseAdminEmails(" Dean@usa.edu.ph, staff@usa.edu.ph;bad, dean@usa.edu.ph ")).toEqual(["dean@usa.edu.ph", "staff@usa.edu.ph"]);
    expect(parseAdminEmails('["Dean@usa.edu.ph", "staff@usa.edu.ph"]')).toEqual(["dean@usa.edu.ph", "staff@usa.edu.ph"]);
    expect(isDefaultAdmin("DEAN@usa.edu.ph", ["dean@usa.edu.ph"])).toBe(true);
    expect(isDefaultAdmin(null, ["dean@usa.edu.ph"])).toBe(false);
  });

  it("listed users become admin of existing schools on sign-in and of schools created later; others do not", async () => {
    process.env.DEFAULT_ADMIN_EMAILS = "staff@usa.edu.ph, late@usa.edu.ph";
    const t = convexTest(schema, modules);
    const as = (id: string) => t.withIdentity({ subject: id, name: id, email: `${id}@usa.edu.ph`, emailVerified: true });
    const owner = as("owner"), staff = as("staff"), late = as("late"), plain = as("plain");
    await owner.mutation(api.users.store, {});
    const org1 = await createOrg(t, owner, "CICT");
    await staff.mutation(api.users.store, {});                                  // signs in after the school exists
    await plain.mutation(api.users.store, {});
    await late.mutation(api.users.store, {});
    const org2 = await createOrg(t, owner, "CAS");       // created after they signed in
    for (const orgId of [org1, org2]) {
      expect((await staff.query(api.orgs.listMine, {})).find((o) => o._id === orgId)?.role).toBe("admin");
      expect((await late.query(api.orgs.listMine, {})).find((o) => o._id === orgId)?.role).toBe("admin");
    }
    expect(await plain.query(api.orgs.listMine, {})).toEqual([]);
    expect(await code(staff.query(api.admin.listFaculty, { orgId: org1 }))).toBe("OK");
    expect(await code(plain.query(api.admin.listFaculty, { orgId: org1 }))).toBe("FORBIDDEN");
    const trail = await owner.query(api.admin.auditTrail, { orgId: org1, query: "DEFAULT_ADMIN_EMAILS" });
    expect(trail.total).toBeGreaterThanOrEqual(2);
  });

  it("never demotes an owner", async () => {
    process.env.DEFAULT_ADMIN_EMAILS = "owner@usa.edu.ph";
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "owner", name: "o", email: "owner@usa.edu.ph", emailVerified: true });
    await owner.mutation(api.users.store, {});
    const orgId = await createOrg(t, owner, "X");
    await owner.mutation(api.users.store, {});
    expect((await owner.query(api.orgs.listMine, {})).find((o) => o._id === orgId)?.role).toBe("owner");
  });

  it("without the variable nobody is auto-promoted", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity({ subject: "a", email: "a@usa.edu.ph", emailVerified: true });
    const b = t.withIdentity({ subject: "b", email: "b@usa.edu.ph", emailVerified: true });
    await a.mutation(api.users.store, {}); await b.mutation(api.users.store, {});
    await createOrg(t, a, "X");
    expect(await b.query(api.orgs.listMine, {})).toEqual([]);
  });
});
