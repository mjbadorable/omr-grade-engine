"use client";
/**
 * Persistent left navigation rail (institutional burgundy): lockup, main destinations, the
 * role-gated Administration group with its sub-links, and Help & Support pinned at the bottom.
 * The same component is the desktop rail and the mobile drawer panel.
 */
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BrandMark } from "@/components/brand/Brand";
import { BRAND } from "@/lib/brand";
import type { Role } from "@/lib/roles/policy";
import { activeNav, parseAdminView, shellNav, type NavId } from "@/lib/shell-nav";
import { openGuide } from "@/lib/tutorial-state";

const ICON: Record<NavId | "help", string> = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  design: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  grade: "M7 3h8l4 4v14H7zM15 3v4h4M10 13l2 2 3-4",
  reports: "M4 20V4m0 16h16M8 16v-5m4 5V8m4 8v-3",
  admin: "M12 3 5 6v6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6zM9 12l2 2 4-4",
  help: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};
export const Icon = ({ id }: { id: NavId | "help" }) => (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON[id]} /></svg>
);

const row = "flex items-center gap-2 rounded-lg border border-transparent px-4 py-2 text-sm font-medium leading-6 transition-colors duration-150 motion-reduce:transition-none";
const idle = "text-[var(--rail-muted)] hover:bg-[var(--rail-hover)] hover:text-white";
const on = "v-rail-active text-white";

function PendingBadge({ orgId }: { orgId: Id<"orgs"> }) {
  const n = useQuery(api.admin.pendingCount, { orgId });
  return n ? <span className="v-badge v-badge-gold ml-auto !text-[11px]" data-testid="rail-pending-badge" title={`${n} pending request${n > 1 ? "s" : ""}`}>{n}</span> : null;
}

function RailLinks({ role, orgId, path, search, onNavigate }: { role: Role | null; orgId: Id<"orgs"> | null; path: string; search: string; onNavigate?: () => void }) {
  const { main, admin } = shellNav(role);
  const active = activeNav(path, search);
  const adminView = parseAdminView(new URLSearchParams(search).get("view"));
  return (
    <>
      <ul className="space-y-2" data-testid="rail-main">
        {main.map((n) => (
          <li key={n.id}>
            <Link href={n.href} onClick={onNavigate} aria-current={active === n.id ? "page" : undefined} data-testid={`rail-${n.id}`} className={`${row} ${active === n.id ? on : idle}`}>
              <Icon id={n.id} />{n.label}
            </Link>
          </li>
        ))}
      </ul>
      {admin && (
        <div className="mt-6 space-y-2" data-testid="rail-admin">
          <p className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase leading-6 tracking-wider text-[var(--rail-muted)]" data-testid="rail-admin-root">
            <Icon id="admin" />Administration
          </p>
          <ul className="space-y-2">
            {admin.map((a) => {
              const here = active === "admin" && adminView === a.view;
              return (
                <li key={a.view}>
                  <Link href={a.href} onClick={onNavigate} aria-current={here ? "page" : undefined} data-testid={`rail-admin-${a.view}`} className={`${row} !pl-12 ${here ? on : idle}`}>
                    {a.label}{a.view === "access" && orgId && <PendingBadge orgId={orgId} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

function RailLinksWithSearch(props: { role: Role | null; orgId: Id<"orgs"> | null; onNavigate?: () => void }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  return <RailLinks {...props} path={path} search={search} />;
}

export default function Rail({ role, orgId, onNavigate }: { role: Role | null; orgId: Id<"orgs"> | null; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" data-testid="rail" className="v-rail flex h-full w-60 flex-col bg-[var(--rail)] text-[var(--rail-fg)]">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2 border-b border-[var(--rail-border)] p-4" aria-label={`${BRAND.name}, Assessment Platform`}>
        {/* the emblem is dark on transparent: a white badge keeps it legible on burgundy */}
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/95 p-1 shadow-sm ring-1 ring-white/50"><BrandMark className="size-8" /></span>
        <span className="min-w-0 leading-tight">
          <span className="block text-base font-bold tracking-wide text-white">{BRAND.name}</span>
          <span className="block text-xs text-[var(--rail-muted)]">Assessment Platform</span>
        </span>
      </Link>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Suspense fallback={<RailLinks role={role} orgId={orgId} path={path} search="" onNavigate={onNavigate} />}>
          <RailLinksWithSearch role={role} orgId={orgId} onNavigate={onNavigate} />
        </Suspense>
      </div>
      <div className="border-t border-[var(--rail-border)] p-4">
        <button type="button" onClick={() => { onNavigate?.(); openGuide(); }} data-testid="rail-help" className={`${row} w-full text-left ${idle}`}>
          <Icon id="help" />Help &amp; Support
        </button>
      </div>
    </nav>
  );
}
