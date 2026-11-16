/**
 * Holds a fresh scan's "send it on" step (outbox record + cloud upload) until the teacher keeps the
 * result. The scan itself is already saved on this device, so nothing is lost; "Erase Paper" just
 * drops the pending step so a bad scan never reaches the sync queue or the cloud.
 */
type Publish = () => void | Promise<void>;

export class PublishGate {
  private pending = new Map<number, Publish>();

  hold(id: number, fn: Publish): void { this.pending.set(id, fn); }
  has(id: number): boolean { return this.pending.has(id); }

  /** Runs the held step once (no-op when nothing is held). */
  async release(id: number): Promise<void> {
    const fn = this.pending.get(id);
    if (!fn) return;
    this.pending.delete(id);
    try { await fn(); } catch { /* a failed hand-off must not break the scan flow; the local copy is kept */ }
  }

  /** Drops the held step. True when something was actually pending. */
  discard(id: number): boolean { return this.pending.delete(id); }

  async releaseAll(): Promise<void> {
    for (const id of [...this.pending.keys()]) await this.release(id);
  }
}
