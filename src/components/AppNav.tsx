"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/designer", label: "1 · Design" },
  { href: "/scan", label: "2 · Scan" },
  { href: "/grade", label: "3 · Grade" },
] as const;

/** Workflow navigation shared by every page. */
export default function AppNav() {
  const path = usePathname();
  return (
    <nav aria-label="Workflow" className="flex items-center gap-1 text-sm">
      {LINKS.map((l) => {
        const on = path === l.href || (l.href === "/designer" && path === "/");
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 ${on ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
