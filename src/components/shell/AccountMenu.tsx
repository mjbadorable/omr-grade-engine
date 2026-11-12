"use client";
/**
 * The one control at the top right: profile trigger (avatar, name, email, role badge) opening a
 * menu with Admin Console, Tutorial & Guide, About VERITAS, Theme, Manage account and Sign out.
 * Signed out or local-only: a compact menu button with the same utilities (+ Sign in when available).
 */
import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useTheme } from "@/components/brand/ThemeToggle";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { ROLE_CLASS, ROLE_LABEL } from "@/lib/active-exam";
import { openAbout } from "@/lib/acknowledgment";
import { isAdmin } from "@/lib/roles/policy";
import { openGuide } from "@/lib/tutorial-state";

const ClerkControls = dynamic(() => import("@/components/cloud/ClerkControls"), { ssr: false });
const item = "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800";
const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "?";

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

function AdminItem({ orgId, onDone }: { orgId: Id<"orgs">; onDone: () => void }) {
  const n = useQuery(api.admin.pendingCount, { orgId });
  return (
    <Link href="/admin" role="menuitem" className={item} onClick={onDone} data-testid="admin-link">
      <Icon d="M12 3 5 6v6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6zM9 12l2 2 4-4" />
      <span className="flex-1">Admin Console</span>
      {n ? <span className="grid min-w-5 place-items-center rounded-full bg-gold px-1.5 text-[10px] font-bold text-white" data-testid="pending-badge" title={`${n} faculty access request${n > 1 ? "s" : ""}`}>{n}</span> : null}
    </Link>
  );
}

function DevSignIn({ onToken, onDone }: { onToken: (t: string) => void; onDone: () => void }) {
  const [token, setToken] = useState("");
  return (
    <div className="space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
      <p className="text-[11px] text-zinc-500">Development sign-in: paste a token from <code>node scripts/dev-auth.mjs token …</code>.</p>
      <textarea aria-label="Dev token" className="h-16 w-full rounded border border-zinc-300 bg-white p-1 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-900" value={token} onChange={(e) => setToken(e.target.value)} />
      <button type="button" className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white disabled:opacity-40" disabled={!token.trim()} onClick={() => { onToken(token); onDone(); }}>Sign in</button>
    </div>
  );
}

export default function AccountMenu() {
  const s = useCloudSession();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  const done = () => setOpen(false);

  const domains = s?.access?.domains ?? ["usa.edu.ph"];
  const signedIn = !!s?.isAuthenticated && !!s.me;
  const denied = signedIn && !!s?.access && !s.access.allowed;
  const clerk = s?.authMode === "clerk";
  const name = s?.me?.name || s?.me?.email || "";
  const role = signedIn && !denied ? s?.workspace.role ?? null : null;

  const utilities = (
    <>
      {signedIn && !denied && isAdmin(role) && s?.workspace.orgId && <AdminItem orgId={s.workspace.orgId} onDone={done} />}
      <button type="button" role="menuitem" className={item} data-testid="guide-trigger" onClick={() => { done(); openGuide(); }}><Icon d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />Tutorial &amp; Guide</button>
      <button type="button" role="menuitem" className={item} data-testid="about-trigger" onClick={() => { done(); openAbout(); }}><Icon d="M12 11v5M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />About VERITAS</button>
      <button type="button" role="menuitem" className={item} data-testid="theme-toggle" onClick={toggle}><Icon d={theme === "dark" ? "M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" : "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"} />Theme: {theme === "dark" ? "Dark" : "Light"}<span className="ml-auto text-[11px] text-zinc-500">{theme === "dark" ? "switch to Light" : "switch to Dark"}</span></button>
    </>
  );

  const popover = open && (
    <div role="menu" aria-label="Account menu" className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-950" data-testid="account-popover">
      {signedIn && !denied && (
        <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <p className="truncate text-sm font-semibold">{name}</p>
          {s?.me?.email && s.me.name && <p className="truncate text-xs text-zinc-500">{s.me.email}</p>}
          {role && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ROLE_CLASS[role]}`}>{ROLE_LABEL[role]}</span>}
        </div>
      )}
      {denied && <p className="border-b border-zinc-100 px-3 py-2 text-xs text-red-700 dark:border-zinc-800 dark:text-red-300" data-testid="access-denied">{s?.access?.message ?? "This account is not allowed."}</p>}
      <div className="py-1">{utilities}</div>
      {s && (
        <div className="border-t border-zinc-100 py-1 dark:border-zinc-800">
          {signedIn ? (
            clerk ? (<><ClerkControls mode="manage" className={item} onDone={done} /><ClerkControls mode="signout" className={item} onDone={done} /></>)
              : <button type="button" role="menuitem" className={item} onClick={() => { done(); s.signOut(); }}>Sign out</button>
          ) : clerk ? <ClerkControls mode="signin-button" domains={domains} className="mx-2 my-1 inline-flex h-9 w-[calc(100%-1rem)] items-center justify-center rounded-md bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700" />
            : s.authMode === "dev" ? <DevSignIn onToken={s.signInDev} onDone={done} />
            : <p className="px-3 py-2 text-xs text-zinc-500">Cloud sign-in is not configured on this deployment.</p>}
        </div>
      )}
    </div>
  );

  // signed in: profile trigger
  if (signedIn) {
    return (
      <div className="relative" ref={ref} data-testid="account-menu">
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="account-trigger"
          className="flex items-center gap-2 rounded-full border border-zinc-200 py-0.5 pl-0.5 pr-2.5 hover:border-indigo-300 sm:pr-3 dark:border-zinc-800">
          {clerk ? <ClerkControls mode="avatar" name={name} className="size-7" /> : <span className="grid size-7 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{initials(name)}</span>}
          <span className="hidden min-w-0 text-left leading-tight md:block"><span className="block max-w-[10rem] truncate text-xs font-semibold" data-testid="account-name">{name}</span>{s?.me?.email && s.me.name && <span className="block max-w-[10rem] truncate text-[10px] text-zinc-500">{s.me.email}</span>}</span>
          {denied ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-800 dark:bg-red-500/15 dark:text-red-300">Not allowed</span>
            : role ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ROLE_CLASS[role]}`} data-testid="role-badge">{ROLE_LABEL[role]}</span>
            : s?.workspace.access === "loading" ? null
            : <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-hover ring-1 ring-inset ring-gold/40 dark:text-gold" data-testid="role-badge">{s?.workspace.access === "pending" ? "Pending" : "No access"}</span>}
          <span aria-hidden className="text-zinc-400">▾</span>
        </button>
        {popover}
      </div>
    );
  }

  // signed out / local-only: one compact menu button
  return (
    <div className="relative" ref={ref} data-testid="account-menu">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="account-trigger"
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 px-3 text-xs font-medium hover:border-indigo-300 dark:border-zinc-800">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        {s && !s.isLoading ? "Menu · Sign in" : "Menu"}
      </button>
      {popover}
    </div>
  );
}
