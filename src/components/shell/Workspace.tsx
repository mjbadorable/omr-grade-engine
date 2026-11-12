"use client";
/**
 * Uniform layout for Design, Scan and Grade: a left sidebar with three zones (pinned header with
 * the stage switcher and active exam, scrollable page controls, pinned footer with the primary
 * status / actions) beside a full-height canvas. On phones the sidebar stacks above the canvas and
 * its controls collapse behind a "Controls" toggle.
 */
import { type ReactNode, useState } from "react";
import AppNav from "@/components/AppNav";
import ActiveExamBar from "./ActiveExamBar";

export default function Workspace({ nav, body, footer, children, controlsLabel = "Controls", defaultOpen = false }: {
  /** always-visible list under the header (Grade views) */
  nav?: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  controlsLabel?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col lg:flex-row" style={{ minHeight: "calc(100dvh - var(--app-header-h, 48px))" }} data-testid="workspace">
      <aside data-testid="sidebar" className="flex w-full shrink-0 flex-col border-b border-zinc-200 bg-white lg:sticky lg:top-[var(--app-header-h,48px)] lg:h-[calc(100dvh-var(--app-header-h,48px))] lg:w-[340px] lg:border-b-0 lg:border-r dark:border-zinc-800 dark:bg-zinc-950">
        <div className="relative z-30 space-y-2 border-b border-zinc-100 p-3 dark:border-zinc-900" data-testid="sidebar-header">
          <AppNav />
          <ActiveExamBar fill />
        </div>
        {nav && <div className="border-b border-zinc-100 p-2 dark:border-zinc-900" data-testid="sidebar-nav">{nav}</div>}
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center justify-between px-4 py-2 text-sm font-medium lg:hidden" data-testid="sidebar-toggle">
          {controlsLabel}<span aria-hidden>{open ? "▴" : "▾"}</span>
        </button>
        <div className={`${open ? "block" : "hidden"} min-h-0 flex-1 overflow-y-auto p-4 lg:block`} data-testid="sidebar-body">{body}</div>
        {footer && <div className="space-y-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950" data-testid="sidebar-footer">{footer}</div>}
      </aside>
      <main className="min-w-0 flex-1" data-testid="workspace-canvas">{children}</main>
    </div>
  );
}
