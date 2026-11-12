"use client";
/** Clerk-only UI (loaded lazily, only when Clerk is the auth provider). */
import { SignInButton, useClerk, useUser } from "@clerk/nextjs";

export type ClerkMode = "signin-button" | "avatar" | "manage" | "signout";

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "?";

export default function ClerkControls({ mode, domains, name, className = "", onDone }: { mode: ClerkMode; domains?: string[]; name?: string; className?: string; onDone?: () => void }) {
  const clerk = useClerk();
  const { user } = useUser();
  if (mode === "signin-button") {
    return (
      <SignInButton mode="modal">
        <button type="button" data-testid="sign-in" title={`Sign in with your ${(domains ?? ["usa.edu.ph"]).map((d) => `@${d}`).join(" / ")} Google account`}
          className={className || "inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 sm:text-sm"}>
          Sign in <span className="hidden sm:inline">(@usa.edu.ph)</span>
        </button>
      </SignInButton>
    );
  }
  if (mode === "avatar") {
    return user?.imageUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={user.imageUrl} alt="" className={`${className} rounded-full object-cover`} />
      : <span className={`${className} grid place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white`}>{initials(name ?? user?.fullName ?? "")}</span>;
  }
  if (mode === "manage") {
    return <button type="button" role="menuitem" className={className} onClick={() => { onDone?.(); clerk.openUserProfile(); }}>Manage account</button>;
  }
  return <button type="button" role="menuitem" className={className} onClick={() => { onDone?.(); void clerk.signOut(); }}>Sign out</button>;
}
