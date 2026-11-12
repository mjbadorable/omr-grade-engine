/**
 * IndexedDB persistence shared by /scan and /grade.
 *
 *   scans        one record per scanned page (raw scanner output, immutable)
 *   overrides    ManualOverridePatch log (append-only)
 *   resolutions  administrative conflict resolutions (append-only)
 *   outbox       sync outbox (seq-keyed)
 *   cloudOps     cloud-mode transaction outbox (id-keyed)
 *   meta         small key/value records (sync cursor, roster per template, …)
 */
import type { ManualOverridePatch } from "@/lib/review/overrides";
import type { CloudOp, CloudOpStore } from "@/lib/sync/offline-outbox";
import type { ConflictResolution, OutboxEntry, OutboxStore } from "@/lib/sync/types";
import type { ScanOutput } from "@/lib/vision/scan-sheet";

export interface StoredScan {
  sheetId: string;
  layoutHash: string;
  templateId: string;
  name: string;
  createdAt: number;
  result: ScanOutput;
  /** de-warped page (JPEG) for review overlays; null for sheets that arrived via sync */
  preview: Blob | null;
  deviceId?: string;
  teacherId?: string;
}

const DB = "omr-grade-engine";
const VERSION = 3;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("scans")) db.createObjectStore("scans", { keyPath: "sheetId" }).createIndex("layoutHash", "layoutHash");
      if (!db.objectStoreNames.contains("overrides")) db.createObjectStore("overrides", { keyPath: "id" }).createIndex("sheetId", "sheetId");
      if (!db.objectStoreNames.contains("resolutions")) db.createObjectStore("resolutions", { keyPath: "id" }).createIndex("layoutHash", "layoutHash");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "seq" });
      if (!db.objectStoreNames.contains("cloudOps")) db.createObjectStore("cloudOps", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = run(t.objectStore(store));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error ?? r.error);
    });
  } finally {
    db.close();
  }
}

// ---- scans
export const putScan = (s: StoredScan) => tx("scans", "readwrite", (st) => st.put(s)).then(() => undefined);
export const deleteScan = (sheetId: string) => tx("scans", "readwrite", (st) => st.delete(sheetId)).then(() => undefined);
export const getScan = (sheetId: string) => tx<StoredScan | undefined>("scans", "readonly", (st) => st.get(sheetId));
export const listScans = (layoutHash: string) =>
  tx<StoredScan[]>("scans", "readonly", (st) => st.index("layoutHash").getAll(IDBKeyRange.only(layoutHash))).then((xs) => xs.sort((a, b) => a.createdAt - b.createdAt));
export async function clearScans(layoutHash: string) {
  for (const s of await listScans(layoutHash)) await deleteScan(s.sheetId);
}

// ---- overrides & resolutions (append-only: no delete API on purpose)
export const putOverride = (p: ManualOverridePatch) => tx("overrides", "readwrite", (st) => st.put(p)).then(() => undefined);
export const listOverrides = () => tx<ManualOverridePatch[]>("overrides", "readonly", (st) => st.getAll());
export const putResolution = (r: ConflictResolution) => tx("resolutions", "readwrite", (st) => st.put(r)).then(() => undefined);
export const listResolutions = (layoutHash: string) =>
  tx<ConflictResolution[]>("resolutions", "readonly", (st) => st.index("layoutHash").getAll(IDBKeyRange.only(layoutHash)));

// ---- meta
export const getMeta = <T>(key: string) => tx<{ key: string; value: T } | undefined>("meta", "readonly", (st) => st.get(key)).then((r) => r?.value ?? null);
export const setMeta = <T>(key: string, value: T) => tx("meta", "readwrite", (st) => st.put({ key, value })).then(() => undefined);

// ---- outbox store
export class IdbOutboxStore implements OutboxStore {
  put(e: OutboxEntry) { return tx("outbox", "readwrite", (st) => st.put(e)).then(() => undefined); }
  all() { return tx<OutboxEntry[]>("outbox", "readonly", (st) => st.getAll()); }
  async maxSeq() {
    const cur = await tx<IDBCursorWithValue | null>("outbox", "readonly", (st) => st.openCursor(null, "prev"));
    return cur ? Number(cur.key) : 0;
  }
  getMeta(k: string) { return getMeta<string>(`sync:${k}`); }
  setMeta(k: string, v: string) { return setMeta(`sync:${k}`, v); }
}

/** Cloud-mode transaction outbox (key saves, overrides, resolutions, scan uploads). */
export class IdbCloudOpStore implements CloudOpStore {
  get(id: string) { return tx<CloudOp | undefined>("cloudOps", "readonly", (st) => st.get(id)); }
  put(op: CloudOp) { return tx("cloudOps", "readwrite", (st) => st.put(op)).then(() => undefined); }
  all() { return tx<CloudOp[]>("cloudOps", "readonly", (st) => st.getAll()); }
  async deleteMany(ids: string[]) { for (const id of ids) await tx("cloudOps", "readwrite", (st) => st.delete(id)); }
}

/** ImageBitmap → JPEG blob (main thread). */
export async function bitmapToJpeg(bmp: ImageBitmap, maxWidth = 900, quality = 0.75): Promise<Blob> {
  const k = Math.min(1, maxWidth / bmp.width);
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: "image/jpeg", quality });
}
