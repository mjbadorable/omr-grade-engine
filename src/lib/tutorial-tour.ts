/**
 * Guided tour model (pure): the flat step list, route matching, which candidate selector to
 * spotlight, and where to put the floating card. All DOM access stays in the component.
 */
import { TUTORIAL, type TutorialStep } from "./tutorial-content";
import { CATEGORIES, type TutorialCategory } from "./tutorial-state";

export interface TourStep extends TutorialStep {
  id: string;
  category: TutorialCategory;
  /** the category's Pro Tip, carried by its last step only */
  tip?: string;
  tipTitle?: string;
}

/** Steps in tour order. Admin steps are left out unless the user is an admin. */
export function tourSteps(admin: boolean): TourStep[] {
  return TUTORIAL.filter((s) => admin || s.id !== "admin").flatMap((s) => s.steps.map((st, i): TourStep => ({
    ...st, id: `${s.id}-${i + 1}`, category: s.id,
    ...(i === s.steps.length - 1 ? { tip: s.tip, tipTitle: s.tipTitle } : {}),
  })));
}

export interface Page { pathname: string; search: string }
const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Are we already on the step's page? A route's query values (e.g. ?tab=key) must match; extra ones on the page are fine. */
export function samePage(current: Page, route: string): boolean {
  const [path, query = ""] = route.split("?");
  if (trimSlash(current.pathname) !== trimSlash(path)) return false;
  const have = new URLSearchParams(current.search);
  for (const [k, v] of new URLSearchParams(query)) if (have.get(k) !== v) return false;
  return true;
}

/** Where a category starts: the first of its steps on the page you are on, else its first step, else the very first step. */
export function startIndex(steps: readonly TourStep[], category: TutorialCategory | null, current: Page): number {
  if (!category || !(CATEGORIES as readonly string[]).includes(category)) return 0;
  const mine = steps.map((s, i) => [s, i] as const).filter(([s]) => s.category === category);
  if (!mine.length) return 0;
  return (mine.find(([s]) => samePage(current, s.route)) ?? mine[0])[1];
}

/** First candidate selector whose element exists and is usable (on screen); null → center the card. */
export function pickTarget<T>(selectors: readonly string[], find: (selector: string) => T | null | undefined, usable: (el: T) => boolean): T | null {
  for (const sel of selectors) { const el = find(sel); if (el && usable(el)) return el; }
  return null;
}

export interface Box { top: number; left: number; width: number; height: number }
export const isCompactViewport = (width: number) => width < 640;

/** The highlighted cutout: the target plus breathing room. */
export const spotlightBox = (t: Box, pad = 8): Box => ({ top: t.top - pad, left: t.left - pad, width: t.width + pad * 2, height: t.height + pad * 2 });

export type Placement = { mode: "center" } | { mode: "dock" } | { mode: "anchored"; placement: "below" | "above" | "right" | "left"; top: number; left: number };

/** Below the target if it fits, else above, else beside it; centered when nothing fits. Phones dock the card at the bottom. */
export function placePopover(target: Box | null, viewport: { w: number; h: number }, card: { w: number; h: number }, gap = 16, margin = 8): Placement {
  if (isCompactViewport(viewport.w)) return { mode: "dock" };
  if (!target) return { mode: "center" };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const bottom = target.top + target.height, right = target.left + target.width;
  const maxLeft = viewport.w - card.w - margin, maxTop = viewport.h - card.h - margin;
  if (bottom + gap + card.h <= viewport.h - margin) return { mode: "anchored", placement: "below", top: bottom + gap, left: clamp(target.left, margin, maxLeft) };
  if (target.top - gap - card.h >= margin) return { mode: "anchored", placement: "above", top: target.top - gap - card.h, left: clamp(target.left, margin, maxLeft) };
  if (right + gap + card.w <= viewport.w - margin) return { mode: "anchored", placement: "right", top: clamp(target.top, margin, maxTop), left: right + gap };
  if (target.left - gap - card.w >= margin) return { mode: "anchored", placement: "left", top: clamp(target.top, margin, maxTop), left: target.left - gap - card.w };
  return { mode: "center" };
}

/**
 * Phones: how far to scroll (positive = down) so the target is not hidden behind the bottom card
 * or the top bar. A target taller than the free space is aligned just under the top bar instead.
 */
export function scrollDeltaForDock(target: Box, viewportH: number, dockH: number, topInset: number, margin = 16): number {
  const minTop = topInset + margin;
  const bottomLimit = viewportH - dockH - margin;
  const bottom = target.top + target.height;
  if (target.top < minTop) return target.top - minTop;
  if (bottom > bottomLimit) return Math.min(bottom - bottomLimit, target.top - minTop);
  return 0;
}
