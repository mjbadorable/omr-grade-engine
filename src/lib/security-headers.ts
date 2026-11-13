/**
 * Browser security headers (pure; consumed by next.config.ts and tests).
 *
 * The CSP ships as Content-Security-Policy-Report-Only first: it reports what it would block without
 * breaking sign-in, the camera or the OpenCV worker. Once the browser console shows no violations on
 * every page, switch the header key to Content-Security-Policy (and replace 'unsafe-inline' for scripts
 * with a hash of the theme-init script).
 */
export interface HeaderOptions {
  /** NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: its frontend host is added to the policy */
  clerkPublishableKey?: string;
  /** development builds need 'unsafe-eval' for React refresh */
  dev?: boolean;
}

/** Clerk's frontend API host, decoded from the publishable key (`pk_live_<base64 of "host$">`). Null if it is not a plain host. */
export function clerkFrontendHost(pk: string | undefined): string | null {
  const m = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(pk ?? "");
  if (!m) return null;
  try {
    const decoded = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const host = /^([a-z0-9.-]+)\$$/.exec(decoded)?.[1];
    return host && host.includes(".") ? host : null;
  } catch { return null; }
}

export function buildCsp(opts: HeaderOptions = {}): string {
  const host = clerkFrontendHost(opts.clerkPublishableKey);
  const clerk = ["https://*.clerk.accounts.dev", ...(host ? [`https://${host}`] : [])];
  const turnstile = "https://challenges.cloudflare.com";           // Clerk's bot check
  const convex = ["https://*.convex.cloud", "wss://*.convex.cloud", "https://*.convex.site"];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(opts.dev ? ["'unsafe-eval'"] : []), ...clerk, turnstile],
    "worker-src": ["'self'", "blob:"],
    "connect-src": ["'self'", ...convex, ...clerk, "https://clerk-telemetry.com"],
    "img-src": ["'self'", "data:", "blob:", "https://*.convex.cloud", "https://img.clerk.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'", "data:"],
    "frame-src": [...clerk, turnstile],
    "media-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

export function securityHeaders(opts: HeaderOptions = {}): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // the scanner needs the camera on this origin only
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    { key: "Content-Security-Policy-Report-Only", value: buildCsp(opts) },
  ];
}
