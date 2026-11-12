/** Per-category tutorial completion + auto-open preference (localStorage), and route → category mapping. */
export const TUTORIAL_KEY = "veritas_tutorial_seen_v1";
export const TUTORIAL_AUTO_KEY = "veritas_tutorial_auto_v1";
export const OPEN_GUIDE_EVENT = "veritas:open-guide";
export const ACK_ACCEPTED_EVENT = "veritas:ack-accepted";

export const CATEGORIES = ["design", "scan", "grade", "admin"] as const;
export type TutorialCategory = (typeof CATEGORIES)[number];
export type SeenMap = Record<TutorialCategory, boolean>;

const EMPTY: SeenMap = { design: false, scan: false, grade: false, admin: false };
type R = Pick<Storage, "getItem">;
type W = Pick<Storage, "setItem">;
const browserStore = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

/** Route → tutorial category; null for routes without a guide. */
export function categoryForPath(path: string | null | undefined): TutorialCategory | null {
  if (!path) return null;
  const p = path.split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/" || p.startsWith("/designer")) return "design";
  if (p.startsWith("/scan")) return "scan";
  if (p.startsWith("/grade")) return "grade";
  if (p.startsWith("/admin")) return "admin";
  return null;
}

export function readSeen(store: R | null = browserStore()): SeenMap {
  try {
    const raw = JSON.parse(store?.getItem(TUTORIAL_KEY) ?? "null") as Partial<Record<string, unknown>> | null;
    return Object.fromEntries(CATEGORIES.map((c) => [c, raw?.[c] === true])) as SeenMap;
  } catch { return { ...EMPTY }; }
}
export function markSeen(cats: readonly TutorialCategory[], store: (R & W) | null = browserStore()): SeenMap {
  const next = { ...readSeen(store), ...Object.fromEntries(cats.map((c) => [c, true])) } as SeenMap;
  try { store?.setItem(TUTORIAL_KEY, JSON.stringify(next)); } catch { /* storage blocked: shown again next visit */ }
  return next;
}

/** "Don't show automatically on new pages" (stored inverted: auto is on unless explicitly turned off). */
export function readAuto(store: R | null = browserStore()): boolean {
  try { return store?.getItem(TUTORIAL_AUTO_KEY) !== "0"; } catch { return true; }
}
export function writeAuto(on: boolean, store: W | null = browserStore()) {
  try { store?.setItem(TUTORIAL_AUTO_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

/** Should the guide open by itself for this route? Only after the institutional acknowledgment. */
export function shouldAutoOpen(o: { acked: boolean; auto: boolean; category: TutorialCategory | null; seen: SeenMap }): boolean {
  return o.acked && o.auto && !!o.category && !o.seen[o.category];
}

export const openGuide = (category?: TutorialCategory) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_GUIDE_EVENT, { detail: category })); };
