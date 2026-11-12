/**
 * Auth providers are configured per deployment with ONE environment variable, so the backend
 * functions stay provider-agnostic (they only use ctx.auth.getUserIdentity()):
 *
 *   OMR_AUTH_PROVIDERS = JSON array of Convex auth providers, e.g.
 *     Clerk:  [{"domain":"https://<your-clerk-domain>","applicationID":"convex"}]
 *     Dev:    [{"type":"customJwt","applicationID":"omr-dev","issuer":"https://omr-dev-auth.local",
 *               "jwks":"data:...","algorithm":"RS256"}]      ← `node scripts/dev-auth.mjs setup`
 *     None:   []
 *
 * PRODUCTION GUARDRAIL: on a production deployment (NODE_ENV=production, OMR_ENV=production, or
 * any non-local deployment that has not declared OMR_ENV=development) the dev issuer and every
 * custom-JWT provider are dropped, leaving verified Clerk OIDC only; see src/lib/cloud/auth-guard.ts.
 * If nothing valid remains, nobody can sign in (fail closed).
 */
import { selectAuthProviders } from "../src/lib/cloud/auth-guard";

const selection = selectAuthProviders(process.env);
if (selection.error) console.error(`[omr-auth] ${selection.error}`);

const authConfig = { providers: selection.providers } as { providers: never[] };
export default authConfig;
