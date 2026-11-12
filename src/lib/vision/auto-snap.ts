/**
 * Auto-Snap gate: capture once when the 4 corners are aligned AND steady, then stay quiet until
 * the sheet leaves the frame (or `rearm()` is called by "Scan Next Sheet"), so one paper is never
 * scanned twice. A minimum interval protects against a flickering detection.
 */
export interface SnapInput { aligned: boolean; stable: boolean; now: number; busy?: boolean }

export class AutoSnapGate {
  private armed = true;
  private lastSnap = -Infinity;
  private missing = 0;
  constructor(private readonly opts: { minIntervalMs?: number; framesToRearm?: number } = {}) {}

  /** true = capture now */
  update(i: SnapInput): boolean {
    if (!i.aligned) { this.missing++; if (this.missing >= (this.opts.framesToRearm ?? 6)) this.armed = true; return false; }
    this.missing = 0;
    if (!this.armed || !i.stable || i.busy) return false;
    if (i.now - this.lastSnap < (this.opts.minIntervalMs ?? 1500)) return false;
    this.armed = false;
    this.lastSnap = i.now;
    return true;
  }
  rearm() { this.armed = true; this.missing = 0; }
  get isArmed() { return this.armed; }
}
