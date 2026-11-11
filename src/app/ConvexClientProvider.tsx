"use client";
/**
 * Convex wiring for the App Router. When NEXT_PUBLIC_CONVEX_URL is not set the app runs exactly
 * as before (local-first, IndexedDB only). With a URL:
 *   NEXT_PUBLIC_OMR_AUTH=dev  → ConvexProviderWithAuth + dev JWTs (local development)
 *   otherwise                 → ConvexProvider (swap in ConvexProviderWithClerk / ConvexAuthProvider
 *                                once the production auth provider is chosen)
 */
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { CloudSessionProvider } from "@/components/cloud/CloudSession";
import { useDevAuth } from "@/lib/cloud/dev-auth";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const authMode = process.env.NEXT_PUBLIC_OMR_AUTH ?? "none";
const client = url ? new ConvexReactClient(url) : null;

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  const session = <CloudSessionProvider authMode={authMode}>{children}</CloudSessionProvider>;
  return authMode === "dev"
    ? <ConvexProviderWithAuth client={client} useAuth={useDevAuth}>{session}</ConvexProviderWithAuth>
    : <ConvexProvider client={client}>{session}</ConvexProvider>;
}
