/** Subtle two-note success chime (Web Audio API, no asset). Mute preference persists in localStorage. */
const MUTE_KEY = "veritas_scan_muted_v1";
const AUTO_KEY = "veritas_autosnap_v1";

export const readMuted = (): boolean => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } };
export const writeMuted = (m: boolean) => { try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* ignore */ } };
/** Auto-Snap is ON unless the user turned it off. */
export const readAutoSnap = (): boolean => { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; } };
export const writeAutoSnap = (on: boolean) => { try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* ignore */ } };

type Ctor = typeof AudioContext;
let ctx: AudioContext | null = null;

/** Call from a user gesture (toggle / capture button) so browsers allow audio later. */
export function unlockAudio() {
  try {
    const C: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!C) return;
    ctx ??= new C();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* audio unavailable */ }
}

export function playChime(kind: "success" | "warn" = "success") {
  try {
    if (readMuted()) return;
    unlockAudio();
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    const notes = kind === "success" ? [880, 1318.5] : [440, 330];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = "sine"; o.frequency.value = f;
      const s = t0 + i * 0.11;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s + 0.015);      // quiet: peak gain 0.12
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24);
      o.connect(g).connect(ctx!.destination);
      o.start(s); o.stop(s + 0.26);
    });
  } catch { /* never break scanning over a sound */ }
}
