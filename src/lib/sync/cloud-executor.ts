/**
 * Replays outbox ops against the cloud. Pure orchestration over a small `CloudApi` so it can be
 * tested with fakes; the app plugs in the Convex client (see CloudSession).
 *
 * Failure policy
 *   - server answered with a coded ConvexError  → permanent (rejected), except the transient codes below
 *   - KEY_VERSION_CONFLICT on a key save        → three-way merge onto the current key, resubmit
 *   - anything else (offline, timeout, 5xx)     → transient: stop the drain, retry later
 */
import type { AnswerKeyBody } from "@/lib/cloud/convert";
import { mergeKeys, describeMerge } from "./key-merge";
import type { CloudOp, CloudOpPayloads, ExecResult, Executor, OverrideWire } from "./offline-outbox";

export interface CloudApi {
  updateKey(a: { examId: string; baseVersion: number; key: AnswerKeyBody; clientKeyId: string }): Promise<{ version: number }>;
  getKey(examId: string): Promise<{ version: number; body: AnswerKeyBody } | null>;
  addOverrides(examId: string, patches: OverrideWire[]): Promise<unknown>;
  resolveConflict(a: { examId: string; rollKey: string; keepScanId: string; clientId: string; timestamp: number }): Promise<unknown>;
  /** null = the scan is no longer available on this device */
  uploadScan(op: CloudOp<"UPLOAD_SCAN">): Promise<unknown | null>;
}

/** Convex application error code (`ConvexError({code})`), if any. */
export const errorCode = (e: unknown): string | undefined => {
  const d = (e as { data?: unknown } | null)?.data;
  return d && typeof d === "object" && typeof (d as { code?: unknown }).code === "string" ? (d as { code: string }).code : undefined;
};
const errorMessage = (e: unknown) => ((e as { data?: { message?: string } })?.data?.message) ?? (e instanceof Error ? e.message : String(e));
/** sign-in problems resolve themselves, and a rate limit frees up with time: keep the queue and try again */
const TRANSIENT_CODES = new Set(["UNAUTHENTICATED", "USER_NOT_REGISTERED", "RATE_LIMITED"]);
const MAX_MERGE_ROUNDS = 4;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no response from the server after ${Math.round(ms / 1000)} s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function makeExecutor(api: CloudApi, opts: { timeoutMs?: number } = {}): Executor {
  const T = opts.timeoutMs ?? 30_000;
  const call = <R>(p: Promise<R>) => withTimeout(p, T);

  async function saveKey(op: CloudOp<"UPDATE_ANSWER_KEY">): Promise<ExecResult> {
    const { baseVersion, base, key } = op.payload as CloudOpPayloads["UPDATE_ANSWER_KEY"];
    try {
      const r = await call(api.updateKey({ examId: op.examId, baseVersion, key, clientKeyId: op.id }));
      return { type: "ok", result: { version: r.version } };
    } catch (e) {
      if (errorCode(e) !== "KEY_VERSION_CONFLICT") throw e;
    }
    // Someone saved a newer key while this device was offline: merge instead of overwriting.
    for (let round = 0; round < MAX_MERGE_ROUNDS; round++) {
      const cur = await call(api.getKey(op.examId));
      if (!cur) return { type: "rejected", reason: "The exam's answer key could not be found." };
      const m = mergeKeys(base, key, cur.body);
      const note = describeMerge(m);
      const level = m.conflicts.length ? "warn" as const : "info" as const;
      if (JSON.stringify(m.merged) === JSON.stringify(cur.body)) return { type: "ok", note, level, result: { version: cur.version } };    // nothing left to save
      try {
        const r = await call(api.updateKey({ examId: op.examId, baseVersion: cur.version, key: m.merged, clientKeyId: op.id }));
        return { type: "ok", note, level, result: { version: r.version } };
      } catch (e) {
        if (errorCode(e) !== "KEY_VERSION_CONFLICT") throw e;            // another teacher saved meanwhile: merge again
      }
    }
    return { type: "retry", error: "The answer key keeps changing; will retry." };
  }

  return async (op) => {
    try {
      switch (op.kind) {
        case "UPDATE_ANSWER_KEY": return await saveKey(op as CloudOp<"UPDATE_ANSWER_KEY">);
        case "APPLY_OVERRIDE": await call(api.addOverrides(op.examId, (op.payload as CloudOpPayloads["APPLY_OVERRIDE"]).patches)); return { type: "ok" };
        case "RESOLVE_CONFLICT": {
          const p = op.payload as CloudOpPayloads["RESOLVE_CONFLICT"];
          await call(api.resolveConflict({ examId: op.examId, rollKey: p.rollKey, keepScanId: p.keepScanId, clientId: op.id, timestamp: op.ts }));
          return { type: "ok" };
        }
        case "UPLOAD_SCAN": {
          const r = await call(api.uploadScan(op as CloudOp<"UPLOAD_SCAN">));
          return r === null ? { type: "rejected", reason: "This scan is no longer stored on this device, so it could not be uploaded." } : { type: "ok", result: r };
        }
      }
    } catch (e) {
      const code = errorCode(e);
      if (code && !TRANSIENT_CODES.has(code)) return { type: "rejected", reason: errorMessage(e) };
      return { type: "retry", error: errorMessage(e) };
    }
  };
}
