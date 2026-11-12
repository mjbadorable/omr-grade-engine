"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/designer", label: "1 · Design" },
  { href: "/scan", label: "2 · Scan" },
  { href: "/grade", label: "3 · Grade" },
] as const;

/** Segmented 1 · Design | 2 · Scan | 3 · Grade switcher (pinned at the top of every workspace sidebar). */
export default function AppNav() {
  const path = usePathname();
  return (
    <nav aria-label="Workflow" data-testid="stage-switcher" className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
      {LINKS.map((l) => {
        const on = path === l.href || (l.href === "/designer" && path === "/");
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
            className={`rounded-md px-1.5 py-1.5 text-center text-[13px] ${on ? "bg-white font-semibold text-indigo-700 shadow-sm ring-1 ring-gold/50 dark:bg-zinc-800 dark:text-indigo-300" : "text-zinc-600 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
