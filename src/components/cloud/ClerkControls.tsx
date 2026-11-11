"use client";
/** Clerk-only UI (loaded lazily, only when Clerk is the auth provider). */
import { SignInButton, useClerk, UserButton } from "@clerk/nextjs";

export default function ClerkControls({ mode, domains }: { mode: "signin" | "signout" | "account"; domains: string[] }) {
  const clerk = useClerk();
  const list = domains.map((d) => `@${d}`).join(" / ");
  if (mode === "signin") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">Sign in with your institutional Google Workspace account ({list}).</p>
        <SignInButton mode="modal">
          <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.2Z" /><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1a6.4 6.4 0 0 1-6-4.4H2.3v2.8A11 11 0 0 0 12 23Z" /><path fill="#FBBC05" d="M6 14.2a6.6 6.6 0 0 1 0-4.4V7H2.3a11 11 0 0 0 0 10l3.7-2.8Z" /><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.3 7L6 9.8a6.4 6.4 0 0 1 6-4.4Z" /></svg>
            Continue with Google
          </button>
        </SignInButton>
      </div>
    );
  }
  if (mode === "signout") {
    return <button type="button" className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm dark:border-zinc-700" onClick={() => clerk.signOut()}>Sign out and use another account</button>;
  }
  return <UserButton />;
}
