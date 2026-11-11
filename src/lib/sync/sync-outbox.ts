/**
 * Append-only outbox + sync engine.
 *
 * Ordering guarantee: `append` calls are serialised through a promise chain, so `seq` is strictly
 * increasing in call order even when callers fire mutations concurrently. Push sends pending
 * entries in `seq` order in batches; a failed batch stops the round so later entries never
 * overtake earlier ones. Key versions are coalesced: only the newest pending version per scope is
 * sent, older ones are marked acked locally (they are superseded, not lost: the newer version
 * contains them).
 */
import type { MutationKind, MutationPayloads, OutboxEntry, OutboxStore, RemoteEntry, SyncDriver } from "./types";

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export class Outbox {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    readonly store: OutboxStore,
    readonly identity: { deviceId: string; teacherId: string },
    private readonly clock: () => number = () => Date.now(),
  ) {}

  append<K extends MutationKind>(kind: K, scope: string, payload: MutationPayloads[K], id = uuid()): Promise<OutboxEntry<K>> {
    const run = async () => {
      const seq = (await this.store.maxSeq()) + 1;
      const entry: OutboxEntry<K> = {
        seq, id, kind, scope, payload,
        deviceId: this.identity.deviceId, teacherId: this.identity.teacherId,
        clientTs: this.clock(), status: "pending",
      };
      await this.store.put(entry as OutboxEntry);
      return entry;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async pending(): Promise<OutboxEntry[]> {
    return (await this.store.all()).filter((e) => e.status === "pending").sort((a, b) => a.seq - b.seq);
  }

  async entries(): Promise<OutboxEntry[]> {
    return (await this.store.all()).sort((a, b) => a.seq - b.seq);
  }
}

export interface SyncReport { pushed: number; superseded: number; rejected: number; pulled: number; cursor: string | null; error?: string }

export class SyncEngine {
  constructor(
    readonly outbox: Outbox,
    readonly driver: SyncDriver,
    private readonly applyRemote: (changes: RemoteEntry[]) => Promise<void>,
    private readonly opts: { batchSize?: number; pullLimit?: number; clock?: () => number } = {},
  ) {}

  private now() { return (this.opts.clock ?? Date.now)(); }

  /** Coalesce superseded key versions; returns the entries to send (in seq order). */
  private async coalesce(pending: OutboxEntry[]): Promise<{ send: OutboxEntry[]; superseded: number }> {
    const newestKey = new Map<string, OutboxEntry>();
    for (const e of pending) if (e.kind === "key.version") newestKey.set(e.scope, e); // seq-ordered → last wins
    let superseded = 0;
    const send: OutboxEntry[] = [];
    for (const e of pending) {
      if (e.kind === "key.version" && newestKey.get(e.scope) !== e) {
        await this.outbox.store.put({ ...e, status: "acked", ackedAt: this.now(), error: "superseded by a newer key version" });
        superseded++;
      } else send.push(e);
    }
    return { send, superseded };
  }

  async push(): Promise<Omit<SyncReport, "pulled" | "cursor">> {
    const { send, superseded } = await this.coalesce(await this.outbox.pending());
    let pushed = 0, rejected = 0;
    const size = this.opts.batchSize ?? 100;
    for (let i = 0; i < send.length; i += size) {
      const batch = send.slice(i, i + size);
      let res;
      try {
        res = await this.driver.push(batch);
      } catch (e) {
        return { pushed, superseded, rejected, error: e instanceof Error ? e.message : String(e) }; // keep order: stop here
      }
      const acked = new Set(res.acked);
      const rej = new Map(res.rejected.map((r) => [r.id, r.reason]));
      for (const e of batch) {
        if (acked.has(e.id)) { await this.outbox.store.put({ ...e, status: "acked", ackedAt: this.now() }); pushed++; }
        else if (rej.has(e.id)) { await this.outbox.store.put({ ...e, status: "rejected", error: rej.get(e.id) }); rejected++; }
      }
      if (acked.size + rej.size < batch.length) return { pushed, superseded, rejected, error: "server did not acknowledge every entry" };
    }
    return { pushed, superseded, rejected };
  }

  async pull(): Promise<{ pulled: number; cursor: string | null; error?: string }> {
    let cursor = await this.outbox.store.getMeta("cursor");
    let pulled = 0;
    const limit = this.opts.pullLimit ?? 500;
    try {
      for (;;) {
        const res = await this.driver.pull(cursor, limit);
        const foreign = res.changes.filter((c) => c.deviceId !== this.outbox.identity.deviceId).sort((a, b) => a.serverSeq - b.serverSeq);
        if (foreign.length) await this.applyRemote(foreign);
        pulled += foreign.length;
        cursor = res.cursor;
        await this.outbox.store.setMeta("cursor", cursor);
        if (res.changes.length < limit) break;
      }
    } catch (e) {
      return { pulled, cursor, error: e instanceof Error ? e.message : String(e) };
    }
    return { pulled, cursor };
  }

  /** push, then pull */
  async syncOnce(): Promise<SyncReport> {
    const p = await this.push();
    if (p.error) return { ...p, pulled: 0, cursor: await this.outbox.store.getMeta("cursor") };
    const q = await this.pull();
    return { ...p, ...q, error: q.error };
  }
}

// ------------------------------------------------------------------ in-memory store (tests, SSR)
export class MemoryOutboxStore implements OutboxStore {
  private entries = new Map<number, OutboxEntry>();
  private meta = new Map<string, string>();
  async put(e: OutboxEntry) { this.entries.set(e.seq, structuredClone(e)); }
  async all() { return [...this.entries.values()].map((e) => structuredClone(e)); }
  async maxSeq() { return Math.max(0, ...this.entries.keys()); }
  async getMeta(k: string) { return this.meta.get(k) ?? null; }
  async setMeta(k: string, v: string) { this.meta.set(k, v); }
}
