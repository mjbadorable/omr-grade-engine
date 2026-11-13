"use client";
/**
 * Interactive guided tour: a moving spotlight that walks the user through the real pages. Each step
 * names a route and the control to highlight; Next / Previous navigate there, wait for the control to
 * mount, scroll it into view and cut a spotlight around it. If the control is not on screen (a phone
 * with the menu closed, local-first mode, a different tab) the card is simply centered.
 *
 * Auto-opens the first time a route is visited, only after the institutional acknowledgment; the
 * "Help & Support" rail item and the profile menu reopen it on the current page's starting step.
 * Non-modal: the page underneath stays usable. Escape closes, arrow keys step.
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { readAck } from "@/lib/acknowledgment";
import { isAdmin } from "@/lib/roles/policy";
import type { IconName } from "@/lib/tutorial-content";
import { ACK_ACCEPTED_EVENT, categoryForPath, markSeen, OPEN_GUIDE_EVENT, readAuto, readSeen, shouldAutoOpen, type TutorialCategory, writeAuto } from "@/lib/tutorial-state";
import { type Box, isCompactViewport, pickTarget, placePopover, samePage, scrollDeltaForDock, spotlightBox, startIndex, tourSteps } from "@/lib/tutorial-tour";

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

const CATEGORY_LABEL: Record<TutorialCategory, string> = { design: "Design", scan: "Scan", grade: "Grade", admin: "Admin" };
const CARD_W = 360;
const SCRIM = "rgba(13, 14, 18, 0.56)";

const onScreen = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const page = () => ({ pathname: window.location.pathname, search: window.location.search });
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export default function TutorialModal() {
  const path = usePathname();
  const router = useRouter();
  const session = useCloudSession();
  const signedIn = !!session?.isAuthenticated && !!session.me;
  const denied = signedIn && !!session?.access && !session.access.allowed;
  const admin = signedIn && !denied && isAdmin(session?.workspace.role ?? null);

  const steps = useMemo(() => tourSteps(admin), [admin]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const [cardH, setCardH] = useState(280);
  const cardRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const viewed = useRef(new Set<TutorialCategory>());
  const pathRef = useRef(path);
  pathRef.current = path;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const openRef = useRef(open);
  openRef.current = open;
  const adminRef = useRef(admin);
  adminRef.current = admin;

  const step = steps[Math.min(index, steps.length - 1)];

  const show = useCallback((category: TutorialCategory | null) => {
    setIndex(startIndex(stepsRef.current, category, page()));
    setOpen(true);
  }, []);

  // auto-open: on a new route, and right after the acknowledgment is accepted (never while a tour is running)
  const maybeAuto = useCallback(() => {
    const category = categoryForPath(pathRef.current);
    if (!category || openRef.current) return;
    if (category === "admin" && !adminRef.current) return;      // teachers are never sent to an "Admins only" screen
    if (shouldAutoOpen({ acked: readAck(), auto: readAuto(), category, seen: readSeen() })) {
      markSeen([category]);                                     // shown once: closing it any way never re-nags
      show(category);
    }
  }, [show]);
  useEffect(() => { setAuto(readAuto()); maybeAuto(); }, [path, admin, maybeAuto]);
  useEffect(() => {
    const onAck = () => maybeAuto();
    const onOpen = (e: Event) => show(((e as CustomEvent<TutorialCategory | undefined>).detail) ?? categoryForPath(pathRef.current));
    window.addEventListener(ACK_ACCEPTED_EVENT, onAck);
    window.addEventListener(OPEN_GUIDE_EVENT, onOpen);
    return () => { window.removeEventListener(ACK_ACCEPTED_EVENT, onAck); window.removeEventListener(OPEN_GUIDE_EVENT, onOpen); };
  }, [maybeAuto, show]);

  const close = useCallback(() => { markSeen([...viewed.current]); setOpen(false); setBox(null); }, []);
  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(stepsRef.current.length - 1, i))), []);

  // drive the current step: navigate to its page, find the control, scroll it into view, keep the cutout on it
  useEffect(() => {
    if (!open || !step) return;
    viewed.current.add(step.category);
    if (!samePage(page(), step.route)) router.push(step.route);
    setBox(null);
    let scrolled = false;
    let dockTimer = 0;
    const measure = () => {
      const el = pickTarget(step.selectors, (s) => document.querySelector<HTMLElement>(s), onScreen);
      if (!el) { setBox((b) => (b ? null : b)); return; }
      if (!scrolled) {
        scrolled = true;
        const smooth = reducedMotion() ? "auto" : "smooth";
        el.scrollIntoView({ block: "center", behavior: smooth });
        if (isCompactViewport(window.innerWidth)) {
          // phones: the card docks at the bottom, so lift the target clear of it once the scroll settles
          dockTimer = window.setTimeout(() => {
            const r = el.getBoundingClientRect();
            const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-header-h")) || 56;
            const dy = scrollDeltaForDock({ top: r.top, left: r.left, width: r.width, height: r.height }, window.innerHeight, cardRef.current?.offsetHeight ?? 280, inset);
            if (dy) window.scrollBy({ top: dy, behavior: smooth });
          }, reducedMotion() ? 60 : 450);
        }
      }
      const r = el.getBoundingClientRect();
      setBox((b) => (b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height ? b : { top: r.top, left: r.left, width: r.width, height: r.height }));
    };
    measure();
    // re-resolve the control regularly: it may mount late (after navigation), re-render or move
    const timer = window.setInterval(measure, 150);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => { window.clearInterval(timer); window.clearTimeout(dockTimer); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
  }, [open, step, router]);

  // viewport size + card height drive placement
  useEffect(() => {
    if (!open) return;
    const size = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, [open]);
  useEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (open && h && h !== cardH) setCardH(h);
  }, [open, step, box, cardH]);

  // keyboard: Escape closes, arrows step (never while typing in a field), focus follows the primary button
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setIndex((i) => Math.min(stepsRef.current.length - 1, i + 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, close]);
  useEffect(() => { if (open) nextRef.current?.focus({ preventScroll: true }); }, [open, step]);

  if (!open || !step) return null;

  const last = index >= steps.length - 1;
  const cats = [...new Set(steps.map((s) => s.category))];
  const place = placePopover(box, vp, { w: CARD_W, h: cardH });
  const spot = box ? spotlightBox(box) : null;
  const pos: React.CSSProperties | undefined = place.mode === "anchored" ? { top: place.top, left: place.left } : undefined;
  const posCls = place.mode === "dock" ? "inset-x-3 bottom-3 max-h-[60dvh] overflow-y-auto" : place.mode === "center" ? "left-1/2 top-1/2 w-[min(22.5rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2" : "w-[22.5rem] transition-[top,left] duration-150 motion-reduce:transition-none";

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" data-testid="tutorial-overlay">
      {spot
        ? <div aria-hidden data-testid="tour-spotlight" className="absolute rounded-xl transition-[top,left,width,height] duration-150 motion-reduce:transition-none" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height, boxShadow: `0 0 0 9999px ${SCRIM}`, outline: "2px solid var(--gold)" }} />
        : <div aria-hidden className="absolute inset-0" style={{ background: SCRIM }} />}

      <section ref={cardRef} role="dialog" aria-modal="false" aria-labelledby="tour-title" data-testid="tutorial-modal" data-placement={place.mode === "anchored" ? place.placement : place.mode}
        className={`pointer-events-auto fixed space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--fg)] shadow-2xl sm:p-6 ${posCls}`} style={pos}>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Guide sections">
          {cats.map((c) => (
            <button key={c} type="button" data-testid={`tour-cat-${c}`} aria-pressed={c === step.category} onClick={() => go(steps.findIndex((s) => s.category === c))}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none ${c === step.category ? "border-[var(--brand-solid)] bg-[var(--brand-solid)] text-white" : "border-[var(--border)] text-zinc-600 hover:border-[var(--brand-soft)] dark:text-zinc-300"}`}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
          <span className="ml-auto text-xs font-medium text-zinc-500" data-testid="tour-counter">Step {index + 1} of {steps.length}</span>
        </div>

        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand)]"><Icon name={step.icon} /></span>
          <div className="min-w-0">
            <h2 id="tour-title" className="text-base font-bold">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{step.body}</p>
          </div>
        </div>

        {step.tip && (
          <aside className="rounded-xl border border-gold/50 border-l-4 border-l-gold bg-gold-tint p-3" data-testid="pro-tip">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-hover dark:text-gold">{step.tipTitle}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{step.tip}</p>
          </aside>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input id="tutorial-auto-off" name="tutorial-auto-off" type="checkbox" className="size-4 accent-indigo-600" checked={!auto} onChange={(e) => { setAuto(!e.target.checked); writeAuto(!e.target.checked); }} />
          Don’t show automatically on new pages
        </label>

        <div className="flex items-center gap-2 border-t border-[var(--border)] pt-4">
          {!last && <button type="button" onClick={close} data-testid="tutorial-done" className="v-btn min-h-10 border-transparent bg-transparent px-4 text-zinc-600 dark:text-zinc-400">Skip</button>}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous step" className="v-btn min-h-10 px-4">← Previous</button>
            {last
              ? <button ref={nextRef} type="button" onClick={close} data-testid="tutorial-done" className="v-btn v-btn-primary min-h-10 px-4">Finish</button>
              : <button ref={nextRef} type="button" onClick={() => go(index + 1)} aria-label="Next step" className="v-btn v-btn-primary min-h-10 px-4">Next →</button>}
          </div>
        </div>
      </section>
    </div>
  );
}
