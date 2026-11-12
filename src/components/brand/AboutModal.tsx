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
import { BRAND } from "@/lib/brand";

const BODY = "This platform is an official project of the University of San Agustin — Educational Technology Office (EdTech) in partnership with the Center for Information and Communications Technology (CICT), developed for faculty to streamline optical mark recognition (OMR) exam grading and Outcomes-Based Education (OBE) analytics.";

/** Circular crest: gold ring, light plate so the logos read the same in light and dark mode. */
function Crest({ src, alt, size, label }: { src: string; alt: string; size: string; label: string }) {
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <div className={`${size} shrink-0 overflow-hidden rounded-full bg-white p-[9%] shadow-sm ring-2 ring-gold ring-offset-2 ring-offset-white dark:ring-offset-zinc-950`}>
        <Image src={src} alt={alt} width={300} height={300} unoptimized className="size-full object-contain" priority />
      </div>
      <figcaption className="text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</figcaption>
    </figure>
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
  const understand = () => { writeAck(); acked.current = true; setState({ ready: true, acked: true, open: false }); };
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
      <div className="space-y-5 px-5 pb-6 pt-5 sm:px-8">
        <div className="flex items-end justify-center gap-3 sm:gap-5" role="group" aria-label="Institutional partners">
          <Crest src="/logos/edtech-logo.png" alt="Educational Technology and E-Learning Support Services logo" size="size-[4.75rem] sm:size-24" label="EdTech" />
          <Crest src="/logos/usa-logo.png" alt="University of San Agustin seal" size="size-[6.5rem] sm:size-32" label="USA" />
          <Crest src="/logos/cict-logo.png" alt="Center for Information and Communications Technology logo" size="size-[4.75rem] sm:size-24" label="CICT" />
        </div>

        <div className="text-center">
          <p className="mx-auto inline-block whitespace-nowrap rounded-full border border-gold/40 bg-gold-tint px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] sm:text-[10px] sm:tracking-[0.14em] text-gold-hover dark:text-gold">University of San Agustin • Iloilo City</p>
          <h2 id="about-title" className="mt-3 text-2xl font-bold tracking-tight">Welcome to <span className="tracking-[0.1em] text-indigo-600">{BRAND.name}</span></h2>
          <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">{BRAND.expansion}</p>
        </div>

        <p id="about-body" className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{BODY}</p>

        <div className="space-y-2">
          <button type="button" autoFocus onClick={understand} data-testid="ack-button"
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
            {locked ? "I Understand" : "I Understand · Close"}
          </button>
          <p className="text-center text-[11px] text-zinc-500">{BRAND.tagline}</p>
        </div>
      </div>
    </dialog>
  );
}
