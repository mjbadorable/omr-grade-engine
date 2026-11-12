#!/usr/bin/env node
/**
 * Dev-only auth for local Convex deployments (no Clerk / Convex Auth needed while developing).
 *
 *   node scripts/dev-auth.mjs setup              → creates .dev-auth/ key pair, prints `npx convex env set` commands
 *   node scripts/dev-auth.mjs token <id> [name] [email]   → prints a signed RS256 JWT valid for 12 h
 *
 * Paste the token in the app (Gradebook → Cloud → "Dev sign-in") or set localStorage "omr:devToken".
 * The issuer is only trusted by deployments whose OMR_AUTH_PROVIDERS includes it (never production).
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), ".dev-auth");
const ISSUER = "https://omr-dev-auth.local";
const KID = "omr-dev-1";
const b64url = (b) => Buffer.from(b).toString("base64url");

function keys() {
  const file = path.join(DIR, "private.pem");
  if (!existsSync(file)) {
    mkdirSync(DIR, { recursive: true });
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  }
  const priv = createPrivateKey(readFileSync(file));
  const jwk = { ...createPublicKey(priv).export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
  return { priv, jwks: { keys: [jwk] } };
}

// Hard stop for production: this script mints tokens for a throwaway key pair.
if (process.env.NODE_ENV === "production" || process.env.OMR_ENV === "production" || /^prod:/.test(process.env.CONVEX_DEPLOYMENT ?? "") || process.env.CONVEX_DEPLOY_KEY?.startsWith("prod:")) {
  console.error("dev-auth is disabled for production (NODE_ENV / OMR_ENV / CONVEX_DEPLOYMENT point at production).");
  process.exit(2);
}
const [cmd, ...args] = process.argv.slice(2);
const { priv, jwks } = keys();
if (cmd === "setup") {
  const uri = `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`;
  const providers = [{ type: "customJwt", applicationID: "omr-dev", issuer: ISSUER, jwks: uri, algorithm: "RS256" }];
  console.log(`npx convex env set OMR_ENV development\nnpx convex env set OMR_AUTH_PROVIDERS '${JSON.stringify(providers)}'`);
} else if (cmd === "token") {
  const [sub = "dev-teacher", name = "Dev Teacher", email = `${sub}@usa.edu.ph`] = args;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const payload = { iss: ISSUER, sub, aud: "omr-dev", iat: now, exp: now + 12 * 3600, name, email, email_verified: true };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  console.log(`${data}.${b64url(sign("RSA-SHA256", Buffer.from(data), priv))}`);
} else {
  console.log("usage: node scripts/dev-auth.mjs setup | token <subject> [name] [email]");
  process.exit(1);
}
