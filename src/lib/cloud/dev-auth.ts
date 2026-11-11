"use client";
/**
 * Dev-only auth adapter for ConvexProviderWithAuth: uses a JWT minted by `scripts/dev-auth.mjs`
 * and kept in localStorage. Enabled with NEXT_PUBLIC_OMR_AUTH=dev; the backend only trusts the
 * dev issuer on deployments whose OMR_AUTH_PROVIDERS includes it. Replace with Clerk's
 * `useAuth` (ConvexProviderWithClerk) or Convex Auth for production.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

const KEY = "omr:devToken";
const EVENT = "omr-auth-changed";

export function setDevToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token.trim());
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useDevAuth() {
  const [state, setState] = useState<{ loading: boolean; token: string | null }>({ loading: true, token: null });
  useEffect(() => {
    const read = () => {
      let token: string | null = null;
      try { token = localStorage.getItem(KEY); } catch { /* ignore */ }
      // drop expired tokens so the UI does not claim a session the backend will reject
      if (token) {
        try {
          const { exp } = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (typeof exp === "number" && exp * 1000 < Date.now()) token = null;
        } catch { token = null; }
      }
      setState({ loading: false, token });
    };
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  const fetchAccessToken = useCallback(async () => state.token, [state.token]);
  return useMemo(() => ({ isLoading: state.loading, isAuthenticated: !!state.token, fetchAccessToken }), [state, fetchAccessToken]);
}
