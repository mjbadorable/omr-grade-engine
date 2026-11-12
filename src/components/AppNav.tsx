"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/brand/ThemeToggle";
import SyncBadge from "@/components/cloud/SyncBadge";
import { openAbout } from "@/lib/acknowledgment";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { isAdmin, type Role } from "@/lib/roles/policy";

const LINKS = [
  { href: "/designer", label: "1 · Design" },
  { href: "/scan", label: "2 · Scan" },
  { href: "/grade", label: "3 · Grade" },
] as const;

/** Workflow navigation shared by every page. */
export default function AppNav() {
  const path = usePathname();
  const cloud = useCloudSession();
  // Admin link only for admins of the selected school (the server enforces the real check).
  const role = (cloud?.orgs?.find((o) => o._id === cloud.selection.orgId)?.role ?? null) as Role | null;
  const links = isAdmin(role) ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <nav aria-label="Workflow" className="flex items-center gap-1 text-sm">
      {links.map((l) => {
        const on = path === l.href || (l.href === "/designer" && path === "/");
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 ${on ? "bg-indigo-50 font-semibold text-indigo-700 shadow-[inset_0_-2px_0_var(--gold)] dark:bg-indigo-500/15 dark:text-indigo-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
            {l.label}
          </Link>
        );
      })}
      <span className="ml-2"><SyncBadge /></span>
      <button type="button" onClick={openAbout} data-testid="about-trigger" title="About VERITAS · Credits" className="ml-1 inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
        <span className="hidden md:inline">About</span>
      </button>
      <span className="ml-1"><ThemeToggle /></span>
    </nav>
  );
}
