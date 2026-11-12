/**
 * Production auth guardrail (pure, shared by convex/auth.config.ts, convex/lib/access.ts and tests).
 *
 * The development token issuer (`scripts/dev-auth.mjs`, issuer https://omr-dev-auth.local) must
 * never be trusted by a production deployment. A deployment counts as production unless it has
 * positively declared itself a development one, so a forgotten variable fails closed:
 *
 *   production  : NODE_ENV === "production", or OMR_ENV === "production", or
 *                 (OMR_ENV !== "development" and the deployment is not a local one)
 *   development : OMR_ENV === "development", or a local (localhost / 127.0.0.1) Convex URL
 *
 * In production only OIDC providers (Clerk: `{domain, applicationID}`) are kept; custom-JWT
 * providers, data: JWKS and the dev issuer are dropped. Every request is additionally checked for
 * a verified @usa.edu.ph email in convex/lib/access.ts.
 */
export const DEV_AUTH_ISSUER = "https://omr-dev-auth.local";
export const DEV_AUTH_APPLICATION_ID = "omr-dev";

export interface AuthEnv {
  NODE_ENV?: string;
  OMR_ENV?: string;
  CONVEX_CLOUD_URL?: string;
  CONVEX_SITE_URL?: string;
  OMR_AUTH_PROVIDERS?: string;
}

type Provider = Record<string, unknown>;

export function isLocalDeployment(env: AuthEnv): boolean {
  const url = `${env.CONVEX_CLOUD_URL ?? ""} ${env.CONVEX_SITE_URL ?? ""}`;
  return /(?:\/\/|@)(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|\s|$)/.test(url);
}

export function isProduction(env: AuthEnv): boolean {
  if (env.NODE_ENV === "production" || env.OMR_ENV === "production") return true;
  if (env.OMR_ENV === "development") return false;
  return !isLocalDeployment(env);
}

export const isDevProvider = (p: Provider): boolean =>
  p.issuer === DEV_AUTH_ISSUER || p.applicationID === DEV_AUTH_APPLICATION_ID || p.type === "customJwt" || (typeof p.jwks === "string" && p.jwks.startsWith("data:"));

export interface ProviderSelection { providers: Provider[]; production: boolean; dropped: string[]; error?: string }

export function selectAuthProviders(env: AuthEnv): ProviderSelection {
  const production = isProduction(env);
  let parsed: unknown;
  try { parsed = JSON.parse(env.OMR_AUTH_PROVIDERS ?? "[]"); } catch { return { providers: [], production, dropped: [], error: "OMR_AUTH_PROVIDERS is not valid JSON" }; }
  if (!Array.isArray(parsed)) return { providers: [], production, dropped: [], error: "OMR_AUTH_PROVIDERS must be a JSON array" };
  const all = parsed.filter((p): p is Provider => !!p && typeof p === "object");
  if (!production) return { providers: all, production, dropped: [] };
  const keep: Provider[] = [], dropped: string[] = [];
  for (const p of all) {
    const domain = typeof p.domain === "string" ? p.domain : "";
    if (isDevProvider(p) || !/^https:\/\/[^/]+/.test(domain)) dropped.push(String(p.issuer ?? p.domain ?? p.applicationID ?? "unknown provider"));
    else keep.push(p);
  }
  return { providers: keep, production, dropped, ...(dropped.length ? { error: `Blocked non-production auth provider(s) on a production deployment: ${dropped.join(", ")}` } : {}) };
}

/** True when a token issued by the dev issuer must be refused (production deployments). */
export const devIdentityBlocked = (issuer: string | undefined, env: AuthEnv): boolean =>
  issuer === DEV_AUTH_ISSUER && isProduction(env);
