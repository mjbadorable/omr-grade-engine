"use client";
/** Global header: brand, 1·2·3 stage switcher, active exam + sync status, guide / about / theme, account. */
import { useEffect, useRef } from "react";
import AppNav from "@/components/AppNav";
import Brand from "@/components/brand/Brand";
import ThemeToggle from "@/components/brand/ThemeToggle";
import { openAbout } from "@/lib/acknowledgment";
import { openGuide } from "@/lib/tutorial-state";
import AccessBanner from "./AccessBanner";
import AccountMenu from "./AccountMenu";
import ActiveExamBar from "./ActiveExamBar";

export default function AppHeader() {
  const ref = useRef<HTMLElement>(null);
  // pages size themselves against the real header height (it wraps on phones)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header ref={ref} data-testid="app-header" className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-4">
        <Brand />
        <div className="order-3 flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 lg:order-none lg:w-auto lg:flex-1">
          <AppNav />
          <ActiveExamBar />
        </div>
        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
          <button type="button" onClick={() => openGuide()} data-testid="guide-trigger" title="Tutorial & Guidelines for this page" className="inline-flex h-8 items-center gap-1 rounded-md border border-gold/50 bg-gold-tint px-2 text-xs font-semibold text-gold-hover hover:brightness-95 dark:text-gold">
            <span aria-hidden className="grid size-4 place-items-center rounded-full bg-gold text-[10px] font-bold text-white">?</span><span>Guide</span>
          </button>
          <button type="button" onClick={openAbout} data-testid="about-trigger" title="About VERITAS · Credits" className="hidden h-8 items-center gap-1 rounded-md px-2 text-xs text-zinc-500 hover:bg-zinc-100 sm:inline-flex dark:hover:bg-zinc-800">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            <span className="hidden md:inline">About</span>
          </button>
          <ThemeToggle />
          <span className="ml-1 border-l border-zinc-200 pl-2 dark:border-zinc-800"><AccountMenu /></span>
        </div>
      </div>
      <AccessBanner />
    </header>
  );
}
