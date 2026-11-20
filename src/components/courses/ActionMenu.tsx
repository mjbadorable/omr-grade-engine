"use client";
/**
 * Compact row-actions menu ("⋯"). The menu is portalled to <body> with fixed positioning, so it is never clipped by a
 * panel's overflow, and it closes on Escape (focus returns to the trigger), on an outside press, on scroll and on resize.
 * Arrow keys move between items. An item may ask for confirmation, which swaps the menu for a Confirm / Cancel prompt.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void | Promise<void>;
  testId?: string;
  danger?: boolean;
  disabled?: boolean;
  /** ask first: the prompt text and the label of the confirming button */
  confirm?: { text: string; action: string; testId?: string };
}

const itemBase = "flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors focus-visible:bg-[var(--brand-tint)] disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:min-h-11";

export default function ActionMenu({ label, items, testId = "row-actions", disabled = false }: { label: string; items: MenuItem[]; testId?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setConfirming(null);
    if (returnFocus) trigger.current?.focus();
  }, []);

  // anchor under the trigger, right-aligned; flip above when there is no room below
  useLayoutEffect(() => {
    if (!open) return;
    const t = trigger.current!.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? 0;
    const below = t.bottom + 6;
    const top = below + h > window.innerHeight - 8 && t.top - 6 - h > 8 ? t.top - 6 - h : below;
    setPos({ top, right: Math.max(8, window.innerWidth - t.right) });
  }, [open, confirming]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(true); }
      else if (e.key === "Tab") close(false);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const els = [...(menu.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
        if (!els.length) return;
        e.preventDefault();
        const at = els.indexOf(document.activeElement as HTMLElement);
        els[(at + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length].focus();
      }
    };
    const onPress = (e: Event) => {
      const n = e.target as Node;
      if (!menu.current?.contains(n) && !trigger.current?.contains(n)) close(false);
    };
    const onAway = () => close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    window.addEventListener("resize", onAway);
    window.addEventListener("scroll", onAway, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("scroll", onAway, true);
    };
  }, [open, close]);

  // keyboard users land on the first action (or the confirm prompt's first button)
  useEffect(() => {
    if (open && pos) menu.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [open, pos, confirming]);

  const run = (it: MenuItem) => { close(true); void it.onSelect(); };

  return (
    <>
      <button
        ref={trigger} type="button" data-testid={testId} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
        onClick={() => { setPos(null); setConfirming(null); setOpen((v) => !v); }}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-transparent text-[var(--fg)] hover:border-[var(--border)] hover:bg-[var(--brand-tint)] disabled:opacity-40 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11">
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
      </button>
      {open && createPortal(
        <div
          ref={menu} id={id} role={confirming ? "alertdialog" : "menu"} aria-label={confirming ? confirming.confirm!.text : label} data-testid="action-menu"
          style={{ position: "fixed", top: pos?.top ?? 0, right: pos?.right ?? 0, visibility: pos ? "visible" : "hidden" }}
          className="v-select-popover z-50 w-max min-w-44 max-w-[calc(100vw-1rem)] p-1 text-[var(--fg)]">
          {confirming ? (
            <div className="space-y-2 p-2">
              <p className="text-sm font-medium">{confirming.confirm!.text}</p>
              <div className="flex gap-2">
                <button type="button" data-testid={confirming.confirm!.testId} className="min-h-9 flex-1 rounded-lg bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-offset-2 [@media(pointer:coarse)]:min-h-11" onClick={() => run(confirming)}>{confirming.confirm!.action}</button>
                <button type="button" className="v-btn min-h-9 flex-1 px-3 text-sm [@media(pointer:coarse)]:min-h-11" onClick={() => close(true)}>Cancel</button>
              </div>
            </div>
          ) : items.map((it) => (
            <button key={it.key} type="button" role="menuitem" data-testid={it.testId} disabled={it.disabled}
              className={`${itemBase} ${it.danger ? "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40" : "hover:bg-[var(--brand-tint)]"}`}
              onClick={() => (it.confirm ? setConfirming(it) : run(it))}>
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
