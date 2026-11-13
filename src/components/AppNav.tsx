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
    <nav aria-label="Workflow" data-testid="stage-switcher" className="v-tabs grid grid-cols-3">
      {LINKS.map((l) => {
        const on = path === l.href || (l.href === "/designer" && path === "/");
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
            className="v-tab text-center">
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
