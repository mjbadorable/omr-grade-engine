import { describe, expect, it } from "vitest";
import { serializeKey } from "@/lib/grading/answer-key";
import { syntheticKey } from "@/lib/grading/simulate";
import { LoopbackDriver, LoopbackServer } from "@/lib/sync/drivers";
import { MemoryOutboxStore, Outbox, SyncEngine } from "@/lib/sync/sync-outbox";
import type { RemoteEntry, ScanCreatedPayload } from "@/lib/sync/types";

const scanPayload = (sheetId: string, roll: string): ScanCreatedPayload => ({
  sheetId, layoutHash: "L", templateId: "T", name: sheetId, createdAt: 0,
  fields: { rollNumber: roll, rollDigits: [...roll], examSet: "A", answers: [], numeric: [], matrix: [], conflicts: [] },
});

function device(id: string, server: LoopbackServer, clockStart = 1000) {
  let t = clockStart;
  const outbox = new Outbox(new MemoryOutboxStore(), { deviceId: id, teacherId: `teacher-${id}` }, () => t++);
  const received: RemoteEntry[] = [];
  const engine = new SyncEngine(outbox, new LoopbackDriver(server), async (c) => { received.push(...c); }, { batchSize: 3 });
  return { outbox, engine, received };
}

describe("Outbox", () => {
  it("assigns strictly increasing seq in call order, even for concurrent appends", async () => {
    const { outbox } = device("d1", new LoopbackServer());
    const entries = await Promise.all(Array.from({ length: 25 }, (_, i) => outbox.append("scan.created", "L", scanPayload(`s${i}`, String(i)))));
    expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(entries.map((e) => (e.payload as ScanCreatedPayload).sheetId)).toEqual(Array.from({ length: 25 }, (_, i) => `s${i}`));
    const ts = entries.map((e) => e.clientTs);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(entries.map((e) => e.id)).size).toBe(25);
  });
});

describe("SyncEngine", () => {
  it("pushes in seq order, in batches, and pulls only other devices' changes", async () => {
    const server = new LoopbackServer();
    const a = device("A", server), b = device("B", server);
    for (let i = 0; i < 7; i++) await a.outbox.append("scan.created", "L", scanPayload(`a${i}`, String(i)));
    await b.outbox.append("scan.created", "L", scanPayload("b0", "99"));
    const ra = await a.engine.syncOnce();
    expect(ra).toMatchObject({ pushed: 7, rejected: 0, pulled: 0 });
    const rb = await b.engine.syncOnce();
    expect(rb).toMatchObject({ pushed: 1, pulled: 7 });
    expect(b.received.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(b.received.every((e) => e.deviceId === "A")).toBe(true);
    await a.engine.syncOnce();
    expect(a.received.map((e) => (e.payload as ScanCreatedPayload).sheetId)).toEqual(["b0"]);
    expect(await a.outbox.pending()).toEqual([]);
  });

  it("keeps entries pending through an outage and never reorders them", async () => {
    const server = new LoopbackServer();
    const a = device("A", server);
    for (let i = 0; i < 5; i++) await a.outbox.append("scan.created", "L", scanPayload(`s${i}`, String(i)));
    server.failPushes = 1;
    const failed = await a.engine.syncOnce();
    expect(failed.error).toMatch(/network/);
    expect((await a.outbox.pending()).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    await a.outbox.append("scan.created", "L", scanPayload("s5", "5"));
    await a.engine.syncOnce();
    const c = device("C", server);
    await c.engine.syncOnce();
    expect(c.received.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("is idempotent: re-sending an acknowledged entry does not duplicate it on the server", async () => {
    const server = new LoopbackServer();
    const a = device("A", server);
    const e = await a.outbox.append("scan.created", "L", scanPayload("s0", "0"));
    await a.engine.syncOnce();
    await new LoopbackDriver(server).push([e]);   // simulated retry after a lost ack
    expect(server.size).toBe(1);
  });

  it("coalesces pending key versions so only the newest is sent", async () => {
    const server = new LoopbackServer();
    const a = device("A", server);
    const k = syntheticKey(3);
    for (let v = 1; v <= 4; v++) await a.outbox.append("key.version", "exam-1", serializeKey({ ...k, version: v }));
    await a.outbox.append("key.version", "exam-2", serializeKey({ ...k, examId: "other", version: 9 }));
    const r = await a.engine.syncOnce();
    expect(r).toMatchObject({ pushed: 2, superseded: 3 });
    const c = device("C", server);
    await c.engine.syncOnce();
    expect(c.received.map((e) => [e.scope, (e.payload as { version: number }).version])).toEqual([["exam-1", 4], ["exam-2", 9]]);
  });
});

describe("HttpSyncDriver", () => {
  it("speaks the REST contract (POST /push, GET /pull?cursor=&limit=) against a fetch-compatible server", async () => {
    const { HttpSyncDriver } = await import("@/lib/sync/drivers");
    const server = new LoopbackServer();
    const calls: string[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      calls.push(`${init?.method ?? "GET"} ${u.pathname}${u.search}`);
      const body = u.pathname.endsWith("/push")
        ? server.push(JSON.parse(String(init?.body)).entries)
        : server.pull(u.searchParams.get("cursor"), Number(u.searchParams.get("limit")));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const mk = (id: string) => {
      const outbox = new Outbox(new MemoryOutboxStore(), { deviceId: id, teacherId: id });
      const got: RemoteEntry[] = [];
      return { outbox, got, engine: new SyncEngine(outbox, new HttpSyncDriver({ baseUrl: "https://sync.example/api/", fetch: fakeFetch }), async (c) => { got.push(...c); }) };
    };
    const a = mk("A"), b = mk("B");
    await a.outbox.append("scan.created", "L", scanPayload("s1", "1"));
    expect(await a.engine.syncOnce()).toMatchObject({ pushed: 1 });
    await b.engine.syncOnce();
    expect(b.got.map((e) => e.id)).toEqual([(await a.outbox.entries())[0].id]);
    expect(calls[0]).toBe("POST /api/push");
    expect(calls[1]).toBe("GET /api/pull?limit=500");
    // pushed entries never carry local-only bookkeeping fields
    expect(Object.keys(b.got[0])).not.toContain("status");
  });

  it("surfaces HTTP errors without losing queued entries", async () => {
    const { HttpSyncDriver } = await import("@/lib/sync/drivers");
    const outbox = new Outbox(new MemoryOutboxStore(), { deviceId: "A", teacherId: "A" });
    await outbox.append("scan.created", "L", scanPayload("s1", "1"));
    const engine = new SyncEngine(outbox, new HttpSyncDriver({ baseUrl: "https://x", fetch: (async () => new Response("no", { status: 503 })) as typeof fetch }), async () => {});
    const r = await engine.syncOnce();
    expect(r.error).toMatch(/503/);
    expect(await outbox.pending()).toHaveLength(1);
  });
});
