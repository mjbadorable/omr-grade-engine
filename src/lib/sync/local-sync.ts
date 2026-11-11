/**
 * Browser wiring of the sync layer: device/teacher identity, the IndexedDB-backed outbox,
 * mutation recorders, and how remote changes are applied locally (append-only merges).
 */
import { parseKey, serializeKey } from "@/lib/grading/answer-key";
import type { AnswerKey } from "@/lib/grading/types";
import type { ManualOverridePatch } from "@/lib/review/overrides";
import type { Roster } from "@/lib/roster/schema";
import { getMeta, IdbOutboxStore, putOverride, putResolution, putScan, setMeta, type StoredScan } from "@/lib/storage/scan-store";
import { readStoredKey, writeStoredKey } from "@/lib/storage/template-store";
import { HttpSyncDriver } from "./drivers";
import { Outbox, SyncEngine } from "./sync-outbox";
import type { ConflictResolution, RemoteEntry, ScanCreatedPayload } from "./types";

const DEVICE_KEY = "omr:deviceId";
const TEACHER_KEY = "omr:teacherId";
const ENDPOINT_KEY = "omr:syncEndpoint";

export function identity(): { deviceId: string; teacherId: string } {
  let deviceId = "server";
  let teacherId = "teacher";
  try {
    deviceId = localStorage.getItem(DEVICE_KEY) ?? "";
    if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, deviceId); }
    teacherId = localStorage.getItem(TEACHER_KEY) || "teacher";
  } catch { /* storage blocked */ }
  return { deviceId, teacherId };
}
export function setTeacherId(name: string) { try { localStorage.setItem(TEACHER_KEY, name.trim() || "teacher"); } catch { /* ignore */ } }
export function syncEndpoint(): string { try { return localStorage.getItem(ENDPOINT_KEY) ?? ""; } catch { return ""; } }
export function setSyncEndpoint(url: string) { try { localStorage.setItem(ENDPOINT_KEY, url.trim()); } catch { /* ignore */ } }

let outbox: Outbox | null = null;
export function localOutbox(): Outbox {
  outbox ??= new Outbox(new IdbOutboxStore(), identity());
  // teacher name may change at runtime
  Object.assign(outbox.identity, { teacherId: identity().teacherId });
  return outbox;
}

// ---- recorders (local mutation → outbox)
export function recordScan(s: StoredScan) {
  const payload: ScanCreatedPayload = { sheetId: s.sheetId, layoutHash: s.layoutHash, templateId: s.templateId, name: s.name, createdAt: s.createdAt, fields: s.result.fields };
  return localOutbox().append("scan.created", s.layoutHash, payload);
}
export const recordOverride = (layoutHash: string, p: ManualOverridePatch) => localOutbox().append("override.added", layoutHash, p);
export const recordKey = (k: AnswerKey) => localOutbox().append("key.version", k.layoutHash ?? k.examId, serializeKey(k));
export const recordRoster = (layoutHash: string, r: Roster) => localOutbox().append("roster.imported", layoutHash, r);
export const recordResolution = (r: ConflictResolution) => localOutbox().append("conflict.resolved", r.layoutHash, r);

export const rosterMetaKey = (layoutHash: string) => `roster:${layoutHash}`;

/** Apply other devices' changes. Scans/patches/resolutions are append-only; key and roster keep the newest. */
export async function applyRemote(changes: RemoteEntry[]): Promise<void> {
  for (const c of changes) {
    switch (c.kind) {
      case "scan.created": {
        const p = c.payload as ScanCreatedPayload;
        // remote scans carry decoded fields only (no image); enough for scoring and conflicts
        await putScan({
          sheetId: p.sheetId, layoutHash: p.layoutHash, templateId: p.templateId, name: `${p.name} (from ${c.teacherId})`, createdAt: p.createdAt,
          result: { fields: p.fields, bubbles: [], layoutHash: p.layoutHash, templateId: p.templateId } as unknown as StoredScan["result"],
          preview: null, deviceId: c.deviceId, teacherId: c.teacherId,
        });
        break;
      }
      case "override.added": await putOverride(c.payload as ManualOverridePatch); break;
      case "conflict.resolved": await putResolution(c.payload as ConflictResolution); break;
      case "key.version": {
        const remote = parseKey(c.payload);
        const local = readStoredKey(c.scope);
        if (!local || remote.version > local.version) writeStoredKey(c.scope, remote);
        break;
      }
      case "roster.imported": {
        const r = c.payload as Roster;
        const cur = await getMeta<Roster>(rosterMetaKey(c.scope));
        if (!cur || r.importedAt > cur.importedAt) await setMeta(rosterMetaKey(c.scope), r);
        break;
      }
    }
  }
}

export function makeEngine(endpoint = syncEndpoint()): SyncEngine | null {
  if (!endpoint) return null;
  return new SyncEngine(localOutbox(), new HttpSyncDriver({ baseUrl: endpoint }), applyRemote);
}
