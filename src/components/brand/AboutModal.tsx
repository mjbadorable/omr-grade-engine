"use client";
/**
 * Institutional acknowledgment. First visit: a modal that cannot be dismissed (no Escape, no
 * backdrop click, no close icon) until "I Understand" is clicked, which persists the choice.
 * Afterwards "About / Credits" in the header reopens it as an ordinary closable dialog.
 * Built on the native <dialog>, so the rest of the page is inert and focus is trapped.
 */
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { OPEN_ABOUT_EVENT, readAck, writeAck } from "@/lib/acknowledgment";
import { ACK_ACCEPTED_EVENT } from "@/lib/tutorial-state";
import { BRAND } from "@/lib/brand";
import { BrandLockup } from "./Brand";

const BODY = "Built for Augustinian educators to make exam checking effortless. Design ZipGrade-style answer sheets, scan papers instantly with your phone camera, and generate Outcomes-Based Education (OBE) item analysis in seconds.";

/** Small credit crest: gold-ringed circle on a light plate so it reads in light and dark mode. */
function MiniCrest({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="size-11 shrink-0 overflow-hidden rounded-full bg-white p-[7%] shadow-sm ring-1 ring-gold/70 sm:size-12">
      <Image src={src} alt={alt} width={96} height={96} unoptimized className="size-full object-contain" />
    </div>
  );
}

export default function AboutModal() {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ ready: boolean; acked: boolean; open: boolean }>({ ready: false, acked: false, open: false });
  const acked = useRef(false);

  // first paint decides: not acknowledged → open locked
  useEffect(() => {
    const a = readAck();
    acked.current = a;
    setState({ ready: true, acked: a, open: !a });
  }, []);
  useEffect(() => {
    const open = () => setState((s) => ({ ...s, open: true }));
    window.addEventListener(OPEN_ABOUT_EVENT, open);
    return () => window.removeEventListener(OPEN_ABOUT_EVENT, open);
  }, []);

  const { open } = state;
  useEffect(() => {
    const d = ref.current;
    if (!d || !state.ready) return;
    if (open && !d.open) { d.showModal(); document.body.style.overflow = "hidden"; }
    if (!open && d.open) { d.close(); }
    if (!open) document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open, state.ready]);

  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const understand = () => {
    const first = !acked.current;
    writeAck(); acked.current = true;
    setState({ ready: true, acked: true, open: false });
    // storage may be blocked: still let the guide appear for this visit
    if (first) window.dispatchEvent(new Event(ACK_ACCEPTED_EVENT));
  };
  const locked = !state.acked;

  if (!state.ready) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby="about-title" aria-describedby="about-body" data-testid="about-modal" data-locked={locked}
      // Escape: always swallowed while unacknowledged; allowed (via close()) afterwards
      onCancel={(e) => { e.preventDefault(); if (!locked) close(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); if (!locked) close(); } }}
      onClick={(e) => { if (!locked && e.target === ref.current) close(); }}
      className="m-auto w-[min(32rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="h-1.5 bg-gradient-to-r from-indigo-600 via-gold to-indigo-600" />
      {!locked && (
        <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-4 rounded-md px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button>
      )}
      <div className="space-y-5 px-5 pb-6 pt-6 sm:px-8">
        <div className="flex justify-center"><BrandLockup className="h-12 sm:h-14" /></div>

        <div className="text-center">
          <p className="mx-auto inline-block whitespace-nowrap rounded-full border border-gold/40 bg-gold-tint px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-gold-hover sm:text-[10px] sm:tracking-[0.14em] dark:text-gold">University of San Agustin • Iloilo City</p>
          <h2 id="about-title" className="mt-3 text-2xl font-bold tracking-tight">Welcome to <span className="tracking-[0.1em] text-indigo-600">{BRAND.name}</span></h2>
          <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">{BRAND.expansion}</p>
        </div>

        <p id="about-body" className="text-center text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{BODY}</p>

        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50" data-testid="credits-strip">
          <div className="flex shrink-0 -space-x-2" role="group" aria-label="Institutional partners">
            <MiniCrest src="/logos/edtech-logo.png" alt="Educational Technology and E-Learning Support Services logo" />
            <MiniCrest src="/logos/usa-logo.png" alt="University of San Agustin seal" />
            <MiniCrest src="/logos/cict-logo.png" alt="Center for Information and Communications Technology logo" />
          </div>
          <p className="text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">A project of the <b>Educational Technology Office (EdTech)</b> &amp; <b>Center for Information and Communications Technology (CICT)</b>.</p>
        </div>

        <button type="button" autoFocus onClick={locked ? understand : close} data-testid="ack-button"
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
          Proceed →
        </button>
      </div>
    </dialog>
  );
}
