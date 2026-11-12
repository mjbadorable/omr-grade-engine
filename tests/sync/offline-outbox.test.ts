import { describe, expect, it } from "vitest";
import type { AnswerKeyBody } from "@/lib/cloud/convert";
import { syntheticKey } from "@/lib/grading/simulate";
import { answerKeyToBody } from "@/lib/cloud/convert";
import { type CloudApi, errorCode, makeExecutor, withTimeout } from "@/lib/sync/cloud-executor";
import { describeMerge, mergeKeys } from "@/lib/sync/key-merge";
import { type CloudOp, MemoryCloudOpStore, OfflineOutbox, type OverrideWire } from "@/lib/sync/offline-outbox";

const body = (mut: (b: AnswerKeyBody) => void = () => {}): AnswerKeyBody => { const b = structuredClone(answerKeyToBody(syntheticKey(6))); mut(b); return b; };
const setCorrect = (b: AnswerKeyBody, q: number, c: number) => { const r = b.questions[String(q)]; if (r.type === "choice") r.correct = [c]; };
const patch = (id: string): OverrideWire => ({ patchId: id, scanId: "s1", target: "answer", questionNumber: 1, originalState: {}, overriddenOption: [0], reason: "smudge", timestamp: 1 });
const conflict = () => Object.assign(new Error("conflict"), { data: { code: "KEY_VERSION_CONFLICT", currentVersion: 9 } });
const coded = (code: string) => Object.assign(new Error(code), { data: { code, message: `server says ${code}` } });

/** In-memory cloud with idempotent mutations, like the Convex functions. */
class FakeCloud implements CloudApi {
  version = 1; keyBody = body(); online = true;
  calls: string[] = []; seenKeyIds = new Map<string, number>(); patches = new Map<string, OverrideWire>(); resolutions = new Set<string>(); scans = new Set<string>();
  failNextWith: Error | null = null;
  private gate() { if (!this.online) throw new Error("offline"); if (this.failNextWith) { const e = this.failNextWith; this.failNextWith = null; throw e; } }
  async updateKey(a: { examId: string; baseVersion: number; key: AnswerKeyBody; clientKeyId: string }) {
    this.calls.push(`key:${a.baseVersion}`); this.gate();
    const done = this.seenKeyIds.get(a.clientKeyId); if (done) return { version: done };
    if (a.baseVersion !== this.version) throw conflict();
    this.keyBody = a.key; this.seenKeyIds.set(a.clientKeyId, ++this.version); return { version: this.version };
  }
  async getKey() { this.gate(); return { version: this.version, body: this.keyBody }; }
  async addOverrides(_e: string, ps: OverrideWire[]) { this.calls.push(`ov:${ps.map((p) => p.patchId)}`); this.gate(); for (const p of ps) this.patches.set(p.patchId, p); }
  async resolveConflict(a: { clientId: string; rollKey: string }) { this.calls.push(`res:${a.rollKey}`); this.gate(); this.resolutions.add(a.clientId); }
  async uploadScan(op: CloudOp<"UPLOAD_SCAN">) { this.calls.push(`scan:${op.payload.sheetId}`); this.gate(); if (op.payload.sheetId === "gone") return null; this.scans.add(op.payload.sheetId); return { status: "stored" }; }
}
function setup(start = 1000) {
  let t = start;
  const outbox = new OfflineOutbox(new MemoryCloudOpStore(), () => t);
  const cloud = new FakeCloud();
  return { outbox, cloud, exec: makeExecutor(cloud, { timeoutMs: 200 }), tick: (ms: number) => { t += ms; }, setClock: (v: number) => { t = v; } };
}

describe("queueing", () => {
  it("assigns increasing seq and strictly monotonic timestamps, even if the clock stands still or goes back", async () => {
    const { outbox, setClock } = setup(5000);
    const a = await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] });
    const b = await outbox.enqueue("RESOLVE_CONFLICT", "e1", { rollKey: "1", keepScanId: "s", supersededScanIds: [], layoutHash: "L" });
    setClock(100);                                         // device clock jumped backwards
    const c = await outbox.enqueue("UPLOAD_SCAN", "e1", { sheetId: "x", layoutHash: "L" });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(b.ts).toBeGreaterThan(a.ts);
    expect(c.ts).toBeGreaterThan(b.ts);
  });

  it("concurrent enqueues keep call order", async () => {
    const { outbox } = setup();
    const ops = await Promise.all(Array.from({ length: 20 }, (_, i) => outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch(`p${i}`)] })));
    expect(ops.map((o) => o.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("enqueueing the same idempotency key twice stores one op", async () => {
    const { outbox } = setup();
    const a = await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] }, "fixed-id");
    const b = await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] }, "fixed-id");
    expect(b.seq).toBe(a.seq);
    expect(await outbox.pending()).toHaveLength(1);
  });

  it("notifies subscribers when the queue changes", async () => {
    const { outbox, cloud, exec } = setup();
    let n = 0; outbox.subscribe(() => n++);
    await outbox.enqueue("UPLOAD_SCAN", "e1", { sheetId: "a", layoutHash: "L" });
    const before = n; await outbox.drain(exec);
    expect(before).toBeGreaterThan(0); expect(n).toBeGreaterThan(before); expect(cloud.scans.has("a")).toBe(true);
  });
});

describe("offline → reconnect replay", () => {
  it("keeps everything while offline and replays in chronological order when back online", async () => {
    const { outbox, cloud, exec } = setup();
    cloud.online = false;
    await outbox.enqueue("UPLOAD_SCAN", "e1", { sheetId: "scan-1", layoutHash: "L" });
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] });
    await outbox.enqueue("RESOLVE_CONFLICT", "e1", { rollKey: "2301", keepScanId: "s1", supersededScanIds: ["s2"], layoutHash: "L" });
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => setCorrect(b, 2, 3)) });
    const off = await outbox.drain(exec);
    expect(off).toMatchObject({ done: 0, remaining: 4 });
    expect(off.stoppedBy).toMatch(/offline/);
    expect((await outbox.pending()).map((o) => o.kind)).toEqual(["UPLOAD_SCAN", "APPLY_OVERRIDE", "RESOLVE_CONFLICT", "UPDATE_ANSWER_KEY"]);

    cloud.online = true; cloud.calls.length = 0;
    const on = await outbox.drain(exec);
    expect(on).toMatchObject({ done: 4, failed: 0, remaining: 0 });
    expect(cloud.calls).toEqual(["scan:scan-1", "ov:p1", "res:2301", "key:1"]);
    expect(await outbox.pending()).toEqual([]);
    expect(cloud.version).toBe(2);
  });

  it("a transient failure in the middle stops the drain so later ops never overtake earlier ones", async () => {
    const { outbox, cloud, exec } = setup();
    for (const id of ["p1", "p2", "p3"]) await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch(id)] });
    cloud.failNextWith = new Error("network blip");        // first call fails
    const r1 = await outbox.drain(exec);
    expect(r1).toMatchObject({ done: 0, remaining: 3 });
    expect(cloud.calls).toEqual(["ov:p1"]);                // p2 / p3 were not attempted
    const r2 = await outbox.drain(exec);
    expect(r2.done).toBe(3);
    expect(cloud.calls.slice(1)).toEqual(["ov:p1", "ov:p2", "ov:p3"]);
    expect((await outbox.all())[0].attempts).toBe(2);
  });

  it("a permanent rejection fails only that op; the rest keep flowing and the reason is reported", async () => {
    const { outbox, cloud, exec } = setup();
    await outbox.enqueue("UPLOAD_SCAN", "e1", { sheetId: "gone", layoutHash: "L" });
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] });
    cloud.failNextWith = null;
    const orig = cloud.addOverrides.bind(cloud);
    cloud.addOverrides = async (e, ps) => { if (ps[0].patchId === "bad") throw coded("REASON_REQUIRED"); return orig(e, ps); };
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [{ ...patch("bad"), reason: "" }] });
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p2")] });
    const r = await outbox.drain(exec);
    expect(r).toMatchObject({ done: 2, failed: 2, remaining: 0 });
    expect(r.notices.filter((n) => n.level === "error").map((n) => n.message)).toEqual(expect.arrayContaining([expect.stringMatching(/no longer stored/), "server says REASON_REQUIRED"]));
    expect([...cloud.patches.keys()]).toEqual(["p1", "p2"]);
    expect((await outbox.failed()).map((o) => o.kind)).toEqual(["UPLOAD_SCAN", "APPLY_OVERRIDE"]);
  });

  it("sign-in problems are transient: the op stays queued", async () => {
    const { outbox, cloud, exec } = setup();
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] });
    cloud.failNextWith = coded("UNAUTHENTICATED");
    expect(await outbox.drain(exec)).toMatchObject({ done: 0, failed: 0, remaining: 1 });
    expect((await outbox.drain(exec)).done).toBe(1);
  });

  it("a server that never answers times out and counts as transient", async () => {
    const { outbox, cloud, exec } = setup();
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] });
    cloud.addOverrides = () => new Promise(() => {});
    const r = await outbox.drain(exec);
    expect(r.remaining).toBe(1);
    expect(r.stoppedBy).toMatch(/no response/);
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(/no response/);
  });

  it("concurrent drains share one run (no double sends)", async () => {
    const { outbox, cloud, exec } = setup();
    for (const id of ["p1", "p2"]) await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch(id)] });
    const [a, b] = await Promise.all([outbox.drain(exec), outbox.drain(exec)]);
    expect(a).toBe(b);
    expect(cloud.calls).toEqual(["ov:p1", "ov:p2"]);
  });

  it("returns per-op results (scan submit status) to the caller", async () => {
    const { outbox, exec } = setup();
    const op = await outbox.enqueue("UPLOAD_SCAN", "e1", { sheetId: "a", layoutHash: "L" });
    const r = await outbox.drain(exec);
    expect(r.results.get(op.id)).toEqual({ status: "stored" });
  });
});

describe("idempotency", () => {
  it("a replay after a lost response does not create a second key version", async () => {
    const { outbox, cloud, exec } = setup();
    const op = await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => setCorrect(b, 1, 2)) });
    // the server applied it but the response was lost → client sees a failure and keeps the op
    const orig = cloud.updateKey.bind(cloud);
    cloud.updateKey = async (a) => { await orig(a); throw new Error("connection reset"); };
    expect((await outbox.drain(exec)).remaining).toBe(1);
    expect(cloud.version).toBe(2);
    cloud.updateKey = orig;
    const r = await outbox.drain(exec);                    // replay with stale baseVersion 1
    expect(r).toMatchObject({ done: 1, failed: 0 });
    expect(cloud.version).toBe(2);                         // still one version
    expect(cloud.seenKeyIds.get(op.id)).toBe(2);
  });

  it("an override replayed twice is applied once", async () => {
    const { outbox, cloud, exec } = setup();
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] }, "same");
    await outbox.drain(exec);
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] }, "same");   // done op already stored under this id
    await outbox.drain(exec);
    expect(cloud.patches.size).toBe(1);
    expect(cloud.calls.filter((c) => c.startsWith("ov:"))).toHaveLength(1);
  });
});

describe("key saves: coalescing and version conflicts", () => {
  it("coalesces queued saves into the newest key with the oldest base, so only one version is created", async () => {
    const { outbox, cloud, exec } = setup();
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => setCorrect(b, 1, 1)) });
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => { setCorrect(b, 1, 1); setCorrect(b, 2, 2); }) });
    const r = await outbox.drain(exec);
    expect(r).toMatchObject({ done: 1, superseded: 1 });
    expect(cloud.version).toBe(2);
    expect((cloud.keyBody.questions["2"] as { correct: number[] }).correct).toEqual([2]);
  });

  it("an override between two key saves keeps its place (no reordering across kinds)", async () => {
    const { outbox, cloud, exec } = setup();
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => setCorrect(b, 1, 1)) });
    await outbox.enqueue("APPLY_OVERRIDE", "e1", { patches: [patch("p1")] });
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => setCorrect(b, 2, 1)) });
    cloud.keyBody = body();
    await outbox.drain(exec);
    expect(cloud.calls.filter((c) => !c.startsWith("key:1")).length).toBeGreaterThanOrEqual(1);
    expect(cloud.calls[1]).toBe("ov:p1");
  });

  it("two teachers editing different questions offline are merged, nothing is lost", async () => {
    const { outbox, cloud, exec } = setup();
    // other teacher already saved v2 changing Q3
    cloud.keyBody = body((b) => setCorrect(b, 3, 3)); cloud.version = 2;
    // this device (offline since v1) changed Q1
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => setCorrect(b, 1, 2)) });
    const r = await outbox.drain(exec);
    expect(r).toMatchObject({ done: 1, failed: 0 });
    expect(cloud.version).toBe(3);
    const q = (n: number) => (cloud.keyBody.questions[String(n)] as { correct: number[] }).correct;
    expect(q(1)).toEqual([2]);                              // mine kept
    expect(q(3)).toEqual([3]);                              // theirs kept
    expect(r.notices[0]).toMatchObject({ level: "info" });
    expect(r.notices[0].message).toMatch(/1 of your offline edits were applied/);
  });

  it("when both changed the same question, the server value wins and the conflict is reported as a warning", async () => {
    const { outbox, cloud, exec } = setup();
    cloud.keyBody = body((b) => setCorrect(b, 1, 3)); cloud.version = 2;
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => { setCorrect(b, 1, 2); setCorrect(b, 4, 1); }) });
    const r = await outbox.drain(exec);
    const q = (n: number) => (cloud.keyBody.questions[String(n)] as { correct: number[] }).correct;
    expect(q(1)).toEqual([3]);                              // other teacher's Q1 kept
    expect(q(4)).toEqual([1]);                              // my non-conflicting Q4 still applied
    expect(r.notices[0].level).toBe("warn");
    expect(r.notices[0].message).toMatch(/1 conflicted.*Q1/);
  });

  it("re-merges when yet another save lands during the merge", async () => {
    const { outbox, cloud, exec } = setup();
    cloud.keyBody = body((b) => setCorrect(b, 3, 3)); cloud.version = 2;
    let injected = false;
    const orig = cloud.updateKey.bind(cloud);
    cloud.updateKey = async (a) => {
      if (a.baseVersion === 2 && !injected) { injected = true; cloud.keyBody = body((b) => { setCorrect(b, 3, 3); setCorrect(b, 5, 2); }); cloud.version = 3; }
      return orig(a);
    };
    await outbox.enqueue("UPDATE_ANSWER_KEY", "e1", { baseVersion: 1, base: body(), key: body((b) => setCorrect(b, 1, 2)) });
    expect((await outbox.drain(exec)).done).toBe(1);
    expect(cloud.version).toBe(4);
    const q = (n: number) => (cloud.keyBody.questions[String(n)] as { correct: number[] }).correct;
    expect([q(1), q(3), q(5)]).toEqual([[2], [3], [2]]);
  });

  it("mergeKeys handles key-level settings and a missing base", () => {
    const base = body();
    const mine = body((b) => { b.gradeBands = [{ minPercent: 0, label: "F" }, { minPercent: 60, label: "P" }]; });
    const theirs = body((b) => { b.conflictPolicy = "score-filled"; });
    const m = mergeKeys(base, mine, theirs);
    expect(m.merged.gradeBands).toEqual(mine.gradeBands);
    expect(m.merged.conflictPolicy).toBe("score-filled");
    expect(m.conflicts).toEqual([]);
    const noBase = mergeKeys(null, body((b) => setCorrect(b, 1, 2)), body((b) => setCorrect(b, 1, 3)));
    expect(noBase.conflicts.map((c) => c.scope)).toEqual(["Q1"]);
    expect(describeMerge(noBase)).toMatch(/their value was kept/);
    expect(describeMerge({ applied: [], conflicts: [] })).toMatch(/matched/);
  });
});

describe("error helpers", () => {
  it("extracts Convex error codes", () => {
    expect(errorCode(coded("FORBIDDEN"))).toBe("FORBIDDEN");
    expect(errorCode(new Error("x"))).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
});
