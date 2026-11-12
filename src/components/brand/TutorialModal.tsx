"use client";
/**
 * Category-aware "Tutorial & Guidelines" dialog (design / scan / grade / admin).
 * Opens automatically the first time a route is visited, but only after the institutional
 * acknowledgment; the header "? Guide" button reopens it on the current route's tab.
 * Native <dialog>: inert background, focus trap, Escape and backdrop click close it.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { readAck } from "@/lib/acknowledgment";
import { TUTORIAL, type IconName, sectionFor } from "@/lib/tutorial-content";
import { ACK_ACCEPTED_EVENT, CATEGORIES, categoryForPath, markSeen, OPEN_GUIDE_EVENT, readAuto, readSeen, shouldAutoOpen, type TutorialCategory, writeAuto } from "@/lib/tutorial-state";

const ICONS: Record<IconName, React.ReactNode> = {
  upload: <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6" />,
  download: <path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16" />,
  qr: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  wand: <path d="M5 19 17 7m0 0 2-2m-2 2-2-2M7 4v2M6 5h2M19 14v3M17.5 15.5h3" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8m-3 3 3 3" /></>,
  refresh: <path d="M20 12a8 8 0 0 1-14 5.3M4 12A8 8 0 0 1 18 6.7M18 3v4h-4M6 21v-4h4" />,
  chart: <path d="M4 20V4m0 16h16M8 16v-5m4 5V8m4 8v-3" />,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M18 14c1.7.7 3 2.5 3 5" /></>,
  shield: <path d="M12 3 5 6v6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6zM9 12l2 2 4-4" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
};
const Icon = ({ name }: { name: IconName }) => <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[name]}</svg>;

export default function TutorialModal() {
  const path = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TutorialCategory>("design");
  const [auto, setAuto] = useState(true);
  const viewed = useRef(new Set<TutorialCategory>());
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const pathRef = useRef(path);
  pathRef.current = path;

  const show = useCallback((cat: TutorialCategory) => { viewed.current.add(cat); setTab(cat); setOpen(true); }, []);

  // auto-open: on a new route, and right after the acknowledgment is accepted
  const maybeAuto = useCallback(() => {
    const category = categoryForPath(pathRef.current);
    if (shouldAutoOpen({ acked: readAck(), auto: readAuto(), category, seen: readSeen() }) && category) {
      markSeen([category]);                     // shown once: closing it any way never re-nags
      show(category);
    }
  }, [show]);
  useEffect(() => { setAuto(readAuto()); maybeAuto(); }, [path, maybeAuto]);
  useEffect(() => {
    const onAck = () => maybeAuto();
    const onOpen = (e: Event) => show(((e as CustomEvent<TutorialCategory | undefined>).detail) ?? categoryForPath(pathRef.current) ?? "design");
    window.addEventListener(ACK_ACCEPTED_EVENT, onAck);
    window.addEventListener(OPEN_GUIDE_EVENT, onOpen);
    return () => { window.removeEventListener(ACK_ACCEPTED_EVENT, onAck); window.removeEventListener(OPEN_GUIDE_EVENT, onOpen); };
  }, [maybeAuto, show]);

  useEffect(() => { viewed.current.add(tab); }, [tab]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal(); document.body.style.overflow = "hidden";
      document.getElementById(`tut-tab-${tabRef.current}`)?.focus();      // focus the active tab, not the first
    }
    if (!open && d.open) d.close();
    if (!open) document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const close = useCallback(() => { markSeen([...viewed.current]); setOpen(false); }, []);
  const idx = CATEGORIES.indexOf(tab);
  const go = (i: number) => setTab(CATEGORIES[(i + CATEGORIES.length) % CATEGORIES.length]);
  const s = sectionFor(tab);

  function onTabKey(e: React.KeyboardEvent) {
    const k = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (k) { e.preventDefault(); const i = idx + k; go(i); requestAnimationFrame(() => document.getElementById(`tut-tab-${CATEGORIES[(i + 4) % 4]}`)?.focus()); }
  }

  return (
    <dialog
      ref={ref} aria-labelledby="tut-title" data-testid="tutorial-modal"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}
      className="m-auto w-[min(40rem,calc(100vw-1rem))] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="h-1.5 bg-gradient-to-r from-indigo-600 via-gold to-indigo-600" />
      <div className="space-y-4 px-4 pb-5 pt-4 sm:px-7">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-hover dark:text-gold">VERITAS · Tutorial &amp; Guidelines</p>
            <h2 id="tut-title" className="mt-0.5 text-lg font-bold tracking-tight sm:text-xl">{s.heading}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close guide" className="rounded-md px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button>
        </div>

        <div role="tablist" aria-label="Guide category" onKeyDown={onTabKey} className="grid grid-cols-4 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {TUTORIAL.map((t) => {
            const on = t.id === tab;
            return (
              <button key={t.id} id={`tut-tab-${t.id}`} role="tab" type="button" aria-selected={on} aria-controls="tut-panel" tabIndex={on ? 0 : -1} onClick={() => setTab(t.id)}
                className={`rounded-lg px-1 py-1.5 text-[11px] font-semibold transition sm:text-sm ${on ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gold/50 dark:bg-zinc-800 dark:text-indigo-300" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                <span className="sm:hidden">{t.id === "admin" ? "Admin" : t.tab.replace(" · ", "·")}</span><span className="hidden sm:inline">{t.tab}</span>
              </button>
            );
          })}
        </div>

        <div id="tut-panel" role="tabpanel" aria-labelledby={`tut-tab-${tab}`} className="space-y-4">
          <ol className="space-y-3">
            {s.steps.map((st, i) => (
              <li key={st.title} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200"><Icon name={st.icon} /></span>
                  {i < s.steps.length - 1 && <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden />}
                </div>
                <div className="min-w-0 pb-1">
                  <p className="text-sm font-semibold"><span className="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-indigo-600 align-middle text-[11px] font-bold text-white">{i + 1}</span>{st.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{st.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <aside className="rounded-xl border border-gold/50 border-l-4 border-l-gold bg-gold-tint p-3" data-testid="pro-tip">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-hover dark:text-gold">{s.tipTitle}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{s.tip}</p>
          </aside>
        </div>

        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 sm:flex-row sm:items-center dark:border-zinc-800">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" className="size-4 accent-indigo-600" checked={!auto} onChange={(e) => { setAuto(!e.target.checked); writeAuto(!e.target.checked); }} />
            Don’t show automatically on new pages
          </label>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button type="button" onClick={() => go(idx - 1)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900" aria-label="Previous category">← Previous</button>
            <button type="button" onClick={() => go(idx + 1)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900" aria-label="Next category">Next →</button>
          </div>
        </div>
        <button type="button" onClick={close} data-testid="tutorial-done" className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">Got It, Let’s Work</button>
      </div>
    </dialog>
  );
}
