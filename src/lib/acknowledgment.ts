/** Institutional acknowledgment (EdTech × CICT) persistence. Bump the version suffix to ask everyone again. */
export const ACK_KEY = "veritas_edtech_cict_ack_v1";
export const OPEN_ABOUT_EVENT = "veritas:open-about";

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;
const browserStore = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

/** true only when the acknowledgment was saved; unreadable storage means "not acknowledged" (ask again). */
export function readAck(store: ReadStore | null = browserStore()): boolean {
  try { return store?.getItem(ACK_KEY) === "1"; } catch { return false; }
}
export function writeAck(store: WriteStore | null = browserStore()): boolean {
  try { if (!store) return false; store.setItem(ACK_KEY, "1"); return true; } catch { return false; }
}
export const openAbout = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_ABOUT_EVENT)); };
