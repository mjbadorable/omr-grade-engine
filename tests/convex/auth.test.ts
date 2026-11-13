// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** Institutional sign-in: only verified @usa.edu.ph Google accounts reach the backend. */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { createOrg } from "../helpers/org";
import { checkInstitutionalEmail, emailDomain, parseDomainList } from "@/lib/cloud/allowlist";

const modules = import.meta.glob("../../convex/**/*.ts");
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { data?: { code?: string } }).data?.code ?? String(e); } };

describe("allowlist rule (pure)", () => {
  const D = ["usa.edu.ph"];
  it.each([
    ["teacher@usa.edu.ph", true, true],
    ["Teacher@USA.EDU.PH ", true, true],
    ["x@mail.usa.edu.ph", true, false],       // subdomains are not the institution's Workspace
    ["x@usa.edu.ph.evil.com", true, false],
    ["x@notusa.edu.ph", true, false],
    ["x@gmail.com", true, false],
    ["a@b@usa.edu.ph", true, false],
    ["teacher@usa.edu.ph", false, false],    // unverified email claim
  ])("%s (verified=%s) → allowed=%s", (email, verified, allowed) => {
    expect(checkInstitutionalEmail({ email, emailVerified: verified }, D).ok).toBe(allowed);
  });
  it("parses domain lists and defaults to usa.edu.ph", () => {
    expect(parseDomainList(undefined)).toEqual(["usa.edu.ph"]);
    expect(parseDomainList(" @USA.edu.ph , school.test ")).toEqual(["usa.edu.ph", "school.test"]);
    expect(emailDomain("no-at-sign")).toBeNull();
  });
});

describe("backend enforcement", () => {
  afterEach(() => { delete process.env.OMR_ALLOWED_EMAIL_DOMAINS; });

  it("refuses outside, unverified and look-alike accounts on every entry point", async () => {
    const t = convexTest(schema, modules);
    const ok = t.withIdentity({ subject: "ok", email: "ana@usa.edu.ph", emailVerified: true, name: "Ana" });
    expect(await code(ok.mutation(api.users.store, {}))).toBe("OK");
    const orgId = await createOrg(t, ok, "USA");

    for (const [who, expected] of [
      [t.withIdentity({ subject: "g", email: "someone@gmail.com", emailVerified: true }), "DOMAIN_NOT_ALLOWED"],
      [t.withIdentity({ subject: "s", email: "x@mail.usa.edu.ph", emailVerified: true }), "DOMAIN_NOT_ALLOWED"],
      [t.withIdentity({ subject: "u", email: "bob@usa.edu.ph", emailVerified: false }), "EMAIL_NOT_VERIFIED"],
      [t.withIdentity({ subject: "n" }), "EMAIL_REQUIRED"],
    ] as const) {
      expect(await code(who.mutation(api.users.store, {}))).toBe(expected);
      expect(await code(who.query(api.orgs.listMine, {}))).toBe(expected);
      expect(await code(who.query(api.exams.listByOrg, { orgId }))).toBe(expected);
      expect(await who.query(api.users.me, {})).toBeNull();
    }
    const status = await t.withIdentity({ subject: "g", email: "someone@gmail.com", emailVerified: true }).query(api.users.accessStatus, {});
    expect(status).toMatchObject({ signedIn: true, allowed: false, code: "DOMAIN_NOT_ALLOWED", domains: ["usa.edu.ph"] });
    expect(await t.query(api.users.accessStatus, {})).toMatchObject({ signedIn: false, allowed: false });
  });

  it("an existing user whose token later carries an outside email loses access", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity({ subject: "same", email: "ana@usa.edu.ph", emailVerified: true }).mutation(api.users.store, {});
    const moved = t.withIdentity({ subject: "same", email: "ana@gmail.com", emailVerified: true });
    expect(await code(moved.query(api.orgs.listMine, {}))).toBe("DOMAIN_NOT_ALLOWED");
  });

  it("accepts the raw email_verified claim from custom-JWT providers", async () => {
    const t = convexTest(schema, modules);
    const raw = t.withIdentity({ subject: "r", email: "rita@usa.edu.ph", email_verified: true });
    expect(await code(raw.mutation(api.users.store, {}))).toBe("OK");
    const rawFalse = t.withIdentity({ subject: "f", email: "fe@usa.edu.ph", email_verified: false });
    expect(await code(rawFalse.mutation(api.users.store, {}))).toBe("EMAIL_NOT_VERIFIED");
  });

  it("the allowlist is configurable per deployment (e.g. a staging test domain)", async () => {
    process.env.OMR_ALLOWED_EMAIL_DOMAINS = "usa.edu.ph,school.test";
    const t = convexTest(schema, modules);
    expect(await code(t.withIdentity({ subject: "q", email: "qa@school.test", emailVerified: true }).mutation(api.users.store, {}))).toBe("OK");
  });
});
