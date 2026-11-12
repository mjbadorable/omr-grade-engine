"use client";
/** Clerk-only UI (loaded lazily, only when Clerk is the auth provider). */
import { SignInButton, useClerk, UserButton } from "@clerk/nextjs";

export default function ClerkControls({ mode, domains }: { mode: "signin" | "signout" | "account" | "signin-button"; domains?: string[] }) {
  const clerk = useClerk();
  if (mode === "signin-button") {
    return (
      <SignInButton mode="modal">
        <button type="button" data-testid="sign-in" title={`Sign in with your ${(domains ?? ["usa.edu.ph"]).map((d) => `@${d}`).join(" / ")} Google account`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 sm:text-sm">
          Sign in <span className="hidden sm:inline">(@usa.edu.ph)</span>
        </button>
      </SignInButton>
    );
  }
  if (mode === "signout") {
    return <button type="button" className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700" onClick={() => clerk.signOut()}>Sign out</button>;
  }
  return <UserButton />;
}
