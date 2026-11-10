/**
 * UI-thread handle for the scanner worker. Promise per request; live-camera alignment is
 * frame-dropping (returns null while the worker is busy) so the UI never queues work.
 */
import type { OMRTemplate } from "@/lib/omr/schema";
import type { ScanOutput } from "./scan-sheet";
import type { CornerPoints, ScanTelemetry, VisionErrorPayload } from "./types";
import type { WorkerRequest, WorkerResponse, WorkerScanOptions } from "./worker-protocol";

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: VisionErrorPayload) => void; onTelemetry?: (t: ScanTelemetry) => void };
/** WorkerRequest without `id`, distributed over the union so literals narrow correctly. */
type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

export class ScannerClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private busy = 0;

  constructor() {
    this.worker = new Worker(new URL("../../workers/omr-scanner.worker.ts", import.meta.url));
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "telemetry") { p.onTelemetry?.(m.telemetry); return; }
      this.pending.delete(m.id);
      this.busy--;
      if (m.type === "error") p.reject(m.error);
      else p.resolve(m);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject({ code: "INTERNAL", message: e.message || "worker crashed" });
      this.pending.clear();
      this.busy = 0;
    };
  }

  get isBusy() { return this.busy > 0; }

  private send(req: RequestBody, transfer: Transferable[] = [], onTelemetry?: (t: ScanTelemetry) => void) {
    const id = ++this.seq;
    this.busy++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onTelemetry });
      this.worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  async init(): Promise<{ loadMs: number }> {
    const r = await this.send({ type: "init" });
    return { loadMs: r.type === "ready" ? r.loadMs : 0 };
  }

  async setTemplate(template: OMRTemplate) {
    await this.send({ type: "setTemplate", template });
  }

  /** Live framing check. Returns null (and closes the bitmap) if a request is already running. */
  align(bitmap: ImageBitmap): Promise<{ corners: CornerPoints | null; telemetry: ScanTelemetry; frameSize: { width: number; height: number } }> | null {
    if (this.isBusy) { bitmap.close(); return null; }
    return this.send({ type: "align", frame: { kind: "imageBitmap", bitmap } }, [bitmap]).then((r) => {
      if (r.type !== "alignment") throw new Error("unexpected response");
      return { corners: r.corners, telemetry: r.telemetry, frameSize: r.frameSize };
    });
  }

  async scan(source: ImageBitmap | Blob, opts: { options?: WorkerScanOptions; preview?: boolean; onTelemetry?: (t: ScanTelemetry) => void } = {}): Promise<{ result: ScanOutput; preview: ImageBitmap | null }> {
    const frame = source instanceof Blob ? { kind: "blob" as const, blob: source } : { kind: "imageBitmap" as const, bitmap: source };
    const r = await this.send({ type: "scan", frame, options: opts.options, preview: opts.preview ?? true }, source instanceof Blob ? [] : [source], opts.onTelemetry);
    if (r.type !== "result") throw new Error("unexpected response");
    return { result: r.result, preview: r.preview };
  }

  terminate() {
    this.worker.terminate();
    this.pending.clear();
  }
}
