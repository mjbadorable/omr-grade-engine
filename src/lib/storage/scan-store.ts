/**
 * Minimal IndexedDB store shared by /scan (writes) and /grade (reads).
 * One record per scanned page; indexed by template layout hash.
 */
import type { ScanOutput } from "@/lib/vision/scan-sheet";

export interface StoredScan {
  sheetId: string;
  layoutHash: string;
  templateId: string;
  name: string;
  createdAt: number;
  result: ScanOutput;
  /** de-warped page (JPEG) for review overlays */
  preview: Blob | null;
}

const DB = "omr-grade-engine";
const STORE = "scans";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "sheetId" });
      s.createIndex("layoutHash", "layoutHash");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = run(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export const putScan = (s: StoredScan) => tx("readwrite", (st) => st.put(s)).then(() => undefined);
export const deleteScan = (sheetId: string) => tx("readwrite", (st) => st.delete(sheetId)).then(() => undefined);
export const listScans = (layoutHash: string) =>
  tx<StoredScan[]>("readonly", (st) => st.index("layoutHash").getAll(IDBKeyRange.only(layoutHash))).then((xs) => xs.sort((a, b) => a.createdAt - b.createdAt));

export async function clearScans(layoutHash: string) {
  for (const s of await listScans(layoutHash)) await deleteScan(s.sheetId);
}

/** ImageBitmap → JPEG blob (main thread). */
export async function bitmapToJpeg(bmp: ImageBitmap, maxWidth = 900, quality = 0.75): Promise<Blob> {
  const k = Math.min(1, maxWidth / bmp.width);
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: "image/jpeg", quality });
}
