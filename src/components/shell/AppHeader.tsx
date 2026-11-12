"use client";
/** The single slim global bar: VERITAS lockup on the left, the profile menu on the right. */
import { useEffect, useRef } from "react";
import Brand from "@/components/brand/Brand";
import AccessBanner from "./AccessBanner";
import AccountMenu from "./AccountMenu";

export default function AppHeader() {
  const ref = useRef<HTMLElement>(null);
  // pages size their workspace against the real header height
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
    <header ref={ref} data-testid="app-header" className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="flex items-center gap-x-4 px-3 py-1.5 sm:px-4" data-testid="header-tier-1">
        <Brand />
        <div className="ml-auto"><AccountMenu /></div>
      </div>
      <AccessBanner />
    </header>
  );
}
