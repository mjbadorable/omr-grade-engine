/**
 * Persistent transaction outbox for CLOUD mode.
 *
 * Everything a teacher does that must reach Convex (key saves, grade overrides, conflict
 * resolutions, scan uploads) is first written here, in IndexedDB, and only then sent. That makes
 * offline work durable (survives reloads/crashes) and lets one drain loop replay it in order.
 *
 *  - Every op has an idempotency key (`id`) that is also sent to the server where the mutation
 *    supports it (answer-key `clientKeyId`, override `patchId`, scan `clientScanId`, resolution
 *    `clientId`), so a replay after a lost response is harmless.
 *  - `ts` is monotonic per device (never equal, never going back even if the clock does), and ops
 *    are replayed in `seq` order, which equals enqueue order.
 *  - A transient failure (offline, timeout, 5xx) stops the drain and keeps order; a permanent
 *    failure (server said no) marks only that op failed and the drain continues.
 *  - Consecutive pending key saves of one exam are coalesced into the newest key, keeping the
 *    OLDEST base version/body so the three-way merge on conflict starts from what the teacher saw.
 */
import type { AnswerKeyBody } from "@/lib/cloud/convert";
import type { ManualOverridePatch } from "@/lib/review/overrides";

export interface OverrideWire {
  patchId: string;
  scanId: string;
  target: ManualOverridePatch["target"];
  questionNumber: number;
  originalState: ManualOverridePatch["originalState"];
  overriddenOption: ManualOverridePatch["overriddenOption"];
  reason: string;
  timestamp: number;
}

export interface CloudOpPayloads {
  UPDATE_ANSWER_KEY: { baseVersion: number; base: AnswerKeyBody | null; key: AnswerKeyBody };
  APPLY_OVERRIDE: { patches: OverrideWire[] };
  RESOLVE_CONFLICT: { rollKey: string; keepScanId: string; supersededScanIds: string[]; layoutHash: string };
  /** the scan itself stays in the scan store (IndexedDB); only a reference is queued */
  UPLOAD_SCAN: { sheetId: string; layoutHash: string };
}
export type CloudOpKind = keyof CloudOpPayloads;

export interface CloudOp<K extends CloudOpKind = CloudOpKind> {
  /** monotonic, starts at 1 */
  seq: number;
  /** idempotency key (UUID) */
  id: string;
  kind: K;
  examId: string;
  payload: CloudOpPayloads[K];
  /** monotonic client timestamp (ms) */
  ts: number;
  status: "pending" | "done" | "failed";
  attempts: number;
  /** human-readable outcome ("merged …", "superseded …") or failure reason */
  note?: string;
  doneAt?: number;
}

export interface CloudOpStore {
  get(id: string): Promise<CloudOp | undefined>;
  put(op: CloudOp): Promise<void>;
  all(): Promise<CloudOp[]>;
  /** drop finished ops older than the retention window */
  deleteMany(ids: string[]): Promise<void>;
}

export type ExecResult =
  | { type: "ok"; note?: string; level?: "info" | "warn"; result?: unknown }
  /** permanent: the server refused; never retried */
  | { type: "rejected"; reason: string }
  /** transient: stop the drain, retry later */
  | { type: "retry"; error: string };

export type Executor = (op: CloudOp) => Promise<ExecResult>;

export interface DrainReport {
  done: number;
  failed: number;
  superseded: number;
  remaining: number;
  /** per op id: what the executor returned (e.g. the scan-submit result) */
  results: Map<string, unknown>;
  stoppedBy?: string;
  notices: { id: string; kind: CloudOpKind; level: "info" | "warn" | "error"; message: string }[];
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const RETENTION_MS = 24 * 3600 * 1000;

export class OfflineOutbox {
  private chain: Promise<unknown> = Promise.resolve();
  private lastTs = 0;
  private draining: Promise<DrainReport> | null = null;
  private listeners = new Set<() => void>();

  constructor(readonly store: CloudOpStore, private readonly clock: () => number = () => Date.now()) {}

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const l of this.listeners) l(); }

  /** Durably queue an op. Re-enqueueing the same `id` returns the existing op (idempotent). */
  enqueue<K extends CloudOpKind>(kind: K, examId: string, payload: CloudOpPayloads[K], id: string = uuid()): Promise<CloudOp<K>> {
    const run = async () => {
      const existing = await this.store.get(id);
      if (existing) return existing as CloudOp<K>;
      const all = await this.store.all();
      const seq = Math.max(0, ...all.map((o) => o.seq)) + 1;
      this.lastTs = Math.max(this.clock(), this.lastTs + 1, ...all.map((o) => o.ts + 1));
      const op: CloudOp<K> = { seq, id, kind, examId, payload, ts: this.lastTs, status: "pending", attempts: 0 };
      await this.store.put(op as CloudOp);
      return op;
    };
    const p = this.chain.then(run, run);          // serialised: seq / ts follow call order
    this.chain = p.catch(() => undefined);
    return p.finally(() => this.emit());
  }

  async pending(): Promise<CloudOp[]> {
    return (await this.store.all()).filter((o) => o.status === "pending").sort((a, b) => a.seq - b.seq);
  }
  async failed(): Promise<CloudOp[]> {
    return (await this.store.all()).filter((o) => o.status === "failed").sort((a, b) => a.seq - b.seq);
  }
  async all(): Promise<CloudOp[]> {
    return (await this.store.all()).sort((a, b) => a.seq - b.seq);
  }

  /** Merge consecutive queued key saves per exam into the newest; the oldest base wins. */
  private async coalesce(pending: CloudOp[]): Promise<{ ops: CloudOp[]; superseded: number }> {
    const out: CloudOp[] = [];
    let superseded = 0;
    for (const op of pending) {
      const prev = out[out.length - 1];
      // only directly adjacent saves of the same exam are merged: an override in between keeps its place
      if (op.kind === "UPDATE_ANSWER_KEY" && prev?.kind === "UPDATE_ANSWER_KEY" && prev.examId === op.examId) {
        const older = prev as CloudOp<"UPDATE_ANSWER_KEY">, newer = op as CloudOp<"UPDATE_ANSWER_KEY">;
        await this.store.put({ ...older, status: "done", doneAt: this.clock(), note: "superseded by a newer queued key save" });
        out[out.length - 1] = { ...newer, payload: { ...newer.payload, baseVersion: older.payload.baseVersion, base: older.payload.base } } as CloudOp;
        await this.store.put(out[out.length - 1]);
        superseded++;
      } else out.push(op);
    }
    return { ops: out, superseded };
  }

  /** Replay every pending op in order. Concurrent callers share one drain. */
  drain(execute: Executor): Promise<DrainReport> {
    this.draining ??= this.runDrain(execute).finally(() => { this.draining = null; this.emit(); });
    return this.draining;
  }

  private async runDrain(execute: Executor): Promise<DrainReport> {
    await this.chain;                                         // let in-flight enqueues land first
    const report: DrainReport = { done: 0, failed: 0, superseded: 0, remaining: 0, results: new Map(), notices: [] };
    const { ops, superseded } = await this.coalesce(await this.pending());
    report.superseded = superseded;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      let res: ExecResult;
      try { res = await execute({ ...op, attempts: op.attempts + 1 }); }
      catch (e) { res = { type: "retry", error: e instanceof Error ? e.message : String(e) }; }
      if (res.type === "retry") {
        await this.store.put({ ...op, attempts: op.attempts + 1, note: res.error });
        report.stoppedBy = res.error;
        report.remaining = ops.length - i;                    // this op and everything after it
        this.emit();
        return report;
      }
      if (res.type === "ok") {
        await this.store.put({ ...op, status: "done", attempts: op.attempts + 1, doneAt: this.clock(), ...(res.note ? { note: res.note } : {}) });
        report.done++;
        if (res.result !== undefined) report.results.set(op.id, res.result);
        if (res.note) report.notices.push({ id: op.id, kind: op.kind, level: res.level ?? "info", message: res.note });
      } else {
        await this.store.put({ ...op, status: "failed", attempts: op.attempts + 1, doneAt: this.clock(), note: res.reason });
        report.failed++;
        report.notices.push({ id: op.id, kind: op.kind, level: "error", message: res.reason });
      }
      this.emit();
    }
    // forget finished ops after a day (keeps the store small, leaves a short audit window locally)
    const cutoff = this.clock() - RETENTION_MS;
    const old = (await this.store.all()).filter((o) => o.status !== "pending" && (o.doneAt ?? 0) < cutoff).map((o) => o.id);
    if (old.length) await this.store.deleteMany(old);
    return report;
  }
}

export class MemoryCloudOpStore implements CloudOpStore {
  private m = new Map<string, CloudOp>();
  async get(id: string) { const o = this.m.get(id); return o ? structuredClone(o) : undefined; }
  async put(op: CloudOp) { this.m.set(op.id, structuredClone(op)); }
  async all() { return [...this.m.values()].map((o) => structuredClone(o)); }
  async deleteMany(ids: string[]) { for (const id of ids) this.m.delete(id); }
}
