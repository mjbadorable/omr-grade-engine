"use client";
/**
 * Top-right account area on every page: sign-in button when signed out; otherwise avatar, name,
 * USA role badge and (for admins) a direct Admin link. The real security boundary is the server.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { ROLE_CLASS, ROLE_LABEL } from "@/lib/active-exam";
import { isAdmin } from "@/lib/roles/policy";

const ClerkControls = dynamic(() => import("@/components/cloud/ClerkControls"), { ssr: false });

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "?";

function DevSignIn({ onToken }: { onToken: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" data-testid="sign-in" onClick={() => setOpen((o) => !o)} className="inline-flex h-8 items-center rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 sm:text-sm">Sign in <span className="ml-1 hidden sm:inline">(dev)</span></button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-xs text-zinc-500">Development sign-in: paste a token from <code>node scripts/dev-auth.mjs token &lt;id&gt; &quot;Name&quot; email</code>.</p>
          <textarea aria-label="Dev token" className="h-20 w-full rounded border border-zinc-300 bg-white p-1 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-900" value={token} onChange={(e) => setToken(e.target.value)} />
          <button type="button" className="rounded-md bg-indigo-600 px-3 py-1 text-white" disabled={!token.trim()} onClick={() => { onToken(token); setOpen(false); }}>Sign in</button>
        </div>
      )}
    </div>
  );
}

/** Admin link with a badge for pending faculty-access requests. */
function AdminLink({ orgId }: { orgId: import("../../../convex/_generated/dataModel").Id<"orgs"> }) {
  const n = useQuery(api.admin.pendingCount, { orgId });
  return (
    <Link href="/admin" className="relative hidden h-8 items-center rounded-md border border-indigo-200 px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 sm:inline-flex dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10" data-testid="admin-link">
      Admin{n ? <span className="ml-1.5 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-white" data-testid="pending-badge" title={`${n} faculty access request${n > 1 ? "s" : ""}`}>{n}</span> : null}
    </Link>
  );
}

export default function AccountMenu() {
  const s = useCloudSession();
  if (!s) return null;                                   // local-only deployment: no accounts
  if (s.isLoading) return <span className="h-8 w-24 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" aria-hidden />;
  const domains = s.access?.domains ?? ["usa.edu.ph"];

  if (!s.isAuthenticated) {
    if (s.authMode === "clerk") return <ClerkControls mode="signin-button" domains={domains} />;
    if (s.authMode === "dev") return <DevSignIn onToken={s.signInDev} />;
    return <span className="text-xs text-zinc-500" title="Cloud sign-in is not configured on this deployment">Local mode</span>;
  }

  if (s.access && !s.access.allowed) {
    return (
      <div className="flex items-center gap-2" data-testid="access-denied" title={s.access.message}>
        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 dark:bg-red-500/15 dark:text-red-300">Account not allowed</span>
        {s.authMode === "clerk" ? <ClerkControls mode="signout" /> : <button type="button" className="text-xs underline" onClick={s.signOut}>Sign out</button>}
      </div>
    );
  }

  const name = s.me?.name || s.me?.email || "Signed in";
  const role = s.workspace.role;
  return (
    <div className="flex items-center gap-2" data-testid="account-menu">
      {isAdmin(role) && s.workspace.orgId && <AdminLink orgId={s.workspace.orgId} />}
      <div className="hidden min-w-0 text-right leading-tight md:block">
        <p className="max-w-[10rem] truncate text-xs font-semibold" data-testid="account-name">{name}</p>
        {s.me?.email && s.me.name && <p className="max-w-[10rem] truncate text-[10px] text-zinc-500">{s.me.email}</p>}
      </div>
      {role ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ROLE_CLASS[role]}`} data-testid="role-badge">{ROLE_LABEL[role]}</span>
        : s.workspace.access === "loading" ? null
        : <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-hover ring-1 ring-inset ring-gold/40 dark:text-gold" data-testid="role-badge" title="Request faculty access from the banner below">{s.workspace.access === "pending" ? "Pending" : "No access"}</span>}
      {s.authMode === "clerk" ? <ClerkControls mode="account" /> : (
        <button type="button" onClick={s.signOut} title="Sign out" className="grid size-8 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{initials(name)}</button>
      )}
    </div>
  );
}
