"use client";
/**
 * App frame: persistent burgundy rail on desktop (a drawer on phones) beside a column with a slim
 * top bar (breadcrumb + profile menu), the faculty-access banner and the page.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand/Brand";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { isAdmin } from "@/lib/roles/policy";
import { breadcrumb } from "@/lib/shell-nav";
import AccessBanner from "./AccessBanner";
import AccountMenu from "./AccountMenu";
import Rail from "./Rail";

function Crumbs({ path, search }: { path: string; search: string }) {
  const crumbs = breadcrumb(path, search);
  if (!crumbs.length) return null;
  return (
    <ol className="flex min-w-0 items-center gap-2 text-sm" data-testid="breadcrumb">
      {crumbs.map((c, i) => (
        <li key={c} className="flex min-w-0 items-center gap-2" aria-current={i === crumbs.length - 1 ? "page" : undefined}>
          {i > 0 && <span aria-hidden className="text-zinc-400">›</span>}
          <span className={`truncate ${i === crumbs.length - 1 ? "font-semibold" : "text-zinc-500"}`}>{c}</span>
        </li>
      ))}
    </ol>
  );
}
function CrumbsWithSearch() {
  return <Crumbs path={usePathname()} search={useSearchParams().toString()} />;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const s = useCloudSession();
  const path = usePathname();
  const signedIn = !!s?.isAuthenticated && !!s.me;
  const denied = signedIn && !!s?.access && !s.access.allowed;
  const role = signedIn && !denied ? s?.workspace.role ?? null : null;
  const orgId = isAdmin(role) ? s?.workspace.orgId ?? null : null;

  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  // pages size their workspace against the real top-bar height (bar + access banner)
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // mobile drawer: focus in, Esc closes, Tab stays inside, focus returns to the menu button
  useEffect(() => {
    if (!open) return;
    const btn = menuBtn.current;
    const items = () => Array.from(drawer.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "Tab") return;
      const f = items();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); btn?.focus(); };
  }, [open]);

  return (
    <div className="flex min-h-dvh" data-testid="app-shell">
      <aside className="sticky top-0 hidden h-dvh shrink-0 lg:block" data-testid="rail-desktop"><Rail role={role} orgId={orgId} /></aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header ref={barRef} data-testid="app-header" className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
          <div className="flex h-14 items-center gap-4 px-4 lg:px-6" data-testid="header-tier-1">
            <button ref={menuBtn} type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(true)} data-testid="rail-toggle"
              className="grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--border)] lg:hidden">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <BrandMark className="size-8 lg:hidden" />
            <Suspense fallback={<Crumbs path={path} search="" />}><CrumbsWithSearch /></Suspense>
            <div className="ml-auto"><AccountMenu /></div>
          </div>
          <AccessBanner />
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" data-testid="rail-drawer">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} tabIndex={-1} />
          <div id="mobile-nav" ref={drawer} role="dialog" aria-modal="true" aria-label="Navigation" className="relative h-full w-60 max-w-[85vw]">
            <Rail role={role} orgId={orgId} onNavigate={() => setOpen(false)} />
            <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg text-[var(--rail-fg)] hover:bg-[var(--rail-hover)]">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
