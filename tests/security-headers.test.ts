import { describe, expect, it } from "vitest";
import { buildCsp, clerkFrontendHost, securityHeaders } from "@/lib/security-headers";

const header = (hs: { key: string; value: string }[], key: string) => hs.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
const directive = (csp: string, name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `) || d === name) ?? "";

describe("securityHeaders", () => {
  const hs = securityHeaders({});

  it("stops MIME sniffing and limits the referrer", () => {
    expect(header(hs, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(hs, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("allows the camera for this origin only (the scanner needs it) and nothing else sensitive", () => {
    expect(header(hs, "Permissions-Policy")).toBe("camera=(self), microphone=(), geolocation=()");
  });

  it("ships the CSP as report-only first, never as an enforcing header", () => {
    expect(header(hs, "Content-Security-Policy-Report-Only")).toBeTruthy();
    expect(header(hs, "Content-Security-Policy")).toBeUndefined();
  });
});

describe("buildCsp", () => {
  const csp = buildCsp({});

  it("blocks framing, plugins and base-tag tricks", () => {
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("lets the OpenCV WebAssembly engine and its worker run, but not eval", () => {
    expect(directive(csp, "script-src")).toContain("'wasm-unsafe-eval'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(csp, "worker-src")).toBe("worker-src 'self' blob:");
  });

  it("lets the app talk to Convex over https and websockets", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("https://*.convex.cloud");
    expect(connect).toContain("wss://*.convex.cloud");
  });

  it("allows Clerk sign-in resources (test instances by default)", () => {
    expect(directive(csp, "script-src")).toContain("https://*.clerk.accounts.dev");
    expect(directive(csp, "connect-src")).toContain("https://*.clerk.accounts.dev");
    expect(directive(csp, "frame-src")).toContain("https://*.clerk.accounts.dev");
  });

  it("adds the production Clerk frontend host derived from the publishable key", () => {
    const pk = `pk_live_${btoa("clerk.example.edu.ph$")}`;
    expect(clerkFrontendHost(pk)).toBe("clerk.example.edu.ph");
    const withKey = buildCsp({ clerkPublishableKey: pk });
    expect(directive(withKey, "script-src")).toContain("https://clerk.example.edu.ph");
    expect(directive(withKey, "connect-src")).toContain("https://clerk.example.edu.ph");
  });

  it("only permits 'unsafe-eval' in development (React refresh)", () => {
    expect(directive(buildCsp({ dev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildCsp({ dev: false }), "script-src")).not.toContain("'unsafe-eval'");
  });
});

describe("clerkFrontendHost", () => {
  it("is null for a missing, malformed or hostile key (never injects into the policy)", () => {
    expect(clerkFrontendHost(undefined)).toBeNull();
    expect(clerkFrontendHost("not-a-key")).toBeNull();
    expect(clerkFrontendHost(`pk_test_${btoa("evil.com; script-src *$")}`)).toBeNull();
    expect(clerkFrontendHost(`pk_test_${btoa("no-trailing-dollar.example.com")}`)).toBeNull();
  });
});
