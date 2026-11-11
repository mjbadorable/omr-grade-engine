/**
 * Reference SyncDriver implementations.
 *
 *  LoopbackServer/LoopbackDriver — in-memory server shared by several clients (tests, demos).
 *  HttpSyncDriver               — generic REST contract for a PostgreSQL (or any) backend:
 *      POST {baseUrl}/push   body { entries: OutboxEntry[] }        → PushResult
 *      GET  {baseUrl}/pull?cursor=<c>&limit=<n>                     → PullResult
 *    The server must treat `id` as an idempotency key and assign a monotonic `serverSeq`.
 *  A Convex adapter implements the same two calls with a mutation and a paginated query.
 */
import type { OutboxEntry, PullResult, PushResult, RemoteEntry, SyncDriver } from "./types";

export class LoopbackServer {
  private log: RemoteEntry[] = [];
  private ids = new Set<string>();
  /** test hook: make the next N push calls throw (simulated outage) */
  failPushes = 0;

  push(entries: readonly OutboxEntry[]): PushResult {
    if (this.failPushes > 0) { this.failPushes--; throw new Error("network unavailable"); }
    const acked: string[] = [];
    const rejected: PushResult["rejected"] = [];
    for (const e of entries) {
      if (!e.id || !e.kind) { rejected.push({ id: e.id, reason: "malformed entry" }); continue; }
      if (!this.ids.has(e.id)) {
        this.ids.add(e.id);
        // `status`, `ackedAt` and `error` are local-only fields
        const { status: _s, ackedAt: _a, error: _e, ...rest } = e;
        void _s; void _a; void _e;
        this.log.push({ ...structuredClone(rest), serverSeq: this.log.length + 1 });
      }
      acked.push(e.id); // idempotent: re-sent entries are acknowledged again
    }
    return { acked, rejected };
  }

  pull(cursor: string | null, limit: number): PullResult {
    const after = cursor ? Number(cursor) : 0;
    const changes = this.log.filter((e) => e.serverSeq > after).slice(0, limit).map((e) => structuredClone(e));
    return { changes, cursor: String(changes.length ? changes[changes.length - 1].serverSeq : after) };
  }

  get size() { return this.log.length; }
}

export class LoopbackDriver implements SyncDriver {
  readonly name = "loopback";
  constructor(private readonly server: LoopbackServer) {}
  async push(entries: readonly OutboxEntry[]) { return this.server.push(entries); }
  async pull(cursor: string | null, limit: number) { return this.server.pull(cursor, limit); }
}

export class HttpSyncDriver implements SyncDriver {
  readonly name = "http";
  constructor(private readonly opts: { baseUrl: string; headers?: Record<string, string>; fetch?: typeof fetch }) {}
  /** call through a plain function: invoking the global fetch as a method of this object throws "Illegal invocation" */
  private f(input: string, init?: RequestInit) {
    return (this.opts.fetch ?? globalThis.fetch.bind(globalThis))(input, init);
  }
  private url(path: string) { return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`; }

  async push(entries: readonly OutboxEntry[]): Promise<PushResult> {
    const body = entries.map(({ status: _s, ackedAt: _a, error: _e, ...rest }) => { void _s; void _a; void _e; return rest; });
    const r = await this.f(this.url("/push"), { method: "POST", headers: { "content-type": "application/json", ...this.opts.headers }, body: JSON.stringify({ entries: body }) });
    if (!r.ok) throw new Error(`push failed: HTTP ${r.status}`);
    const j = (await r.json()) as PushResult;
    if (!Array.isArray(j.acked) || !Array.isArray(j.rejected)) throw new Error("push: malformed response");
    return j;
  }

  async pull(cursor: string | null, limit: number): Promise<PullResult> {
    const q = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    const r = await this.f(this.url(`/pull?${q}`), { headers: { ...this.opts.headers } });
    if (!r.ok) throw new Error(`pull failed: HTTP ${r.status}`);
    const j = (await r.json()) as PullResult;
    if (!Array.isArray(j.changes) || typeof j.cursor !== "string") throw new Error("pull: malformed response");
    return j;
  }
}
