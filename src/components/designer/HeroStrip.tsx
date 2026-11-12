"use client";
/** Slim VERITAS hero for the designer: acronym + tagline, dismissible (remembered in this browser). */
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/Brand";
import { BRAND } from "@/lib/brand";

const KEY = "omr:heroDismissed";

export default function HeroStrip() {
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(localStorage.getItem(KEY) !== "1"); } catch { setShow(true); } }, []);
  if (!show) return null;
  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-gold-tint px-4 py-2 text-sm dark:border-zinc-800" data-testid="hero-strip">
      <BrandMark className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100"><span className="tracking-[0.14em]">{BRAND.name}</span> <span className="font-normal text-zinc-500">· {BRAND.expansion}</span></p>
        <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{BRAND.tagline}</p>
      </div>
      <button type="button" aria-label="Dismiss welcome banner" className="rounded px-2 text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800" onClick={() => { setShow(false); try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } }}>×</button>
    </div>
  );
}
