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
 * Production sets only its real provider; the dev issuer is only ever set on local/dev
 * deployments. (Convex Auth would replace this file with its own provider config.)
 */
const providers = JSON.parse(process.env.OMR_AUTH_PROVIDERS ?? "[]") as Record<string, string>[];

const authConfig = { providers };
export default authConfig;
