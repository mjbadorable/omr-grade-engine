"use client";
/**
 * Convex wiring for the App Router.
 *
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set  → ConvexProviderWithClerk (ClerkProvider is mounted in
 *                                             app/layout.tsx), Google SSO restricted to @usa.edu.ph
 *   NEXT_PUBLIC_OMR_AUTH=dev               → ConvexProviderWithAuth + dev JWTs (local development)
 *   otherwise                              → ConvexProvider without sign-in
 *   no NEXT_PUBLIC_CONVEX_URL              → local-first app, no backend
 */
import { useAuth } from "@clerk/nextjs";
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";
import { CloudSessionProvider } from "@/components/cloud/CloudSession";
import { useDevAuth } from "@/lib/cloud/dev-auth";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
// Dev tokens are never offered in a production build, whatever NEXT_PUBLIC_OMR_AUTH says.
export const AUTH_MODE: "clerk" | "dev" | "none" = clerkKey ? "clerk" : process.env.NEXT_PUBLIC_OMR_AUTH === "dev" && process.env.NODE_ENV !== "production" ? "dev" : "none";
const convex = url ? new ConvexReactClient(url) : null;

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;
  const session = <CloudSessionProvider authMode={AUTH_MODE}>{children}</CloudSessionProvider>;
  if (AUTH_MODE === "clerk") return <ConvexProviderWithClerk client={convex} useAuth={useAuth}>{session}</ConvexProviderWithClerk>;
  if (AUTH_MODE === "dev") return <ConvexProviderWithAuth client={convex} useAuth={useDevAuth}>{session}</ConvexProviderWithAuth>;
  return <ConvexProvider client={convex}>{session}</ConvexProvider>;
}
