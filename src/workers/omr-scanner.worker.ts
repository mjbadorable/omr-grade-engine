/**
 * OMR scanner worker. OpenCV.js is loaded HERE ONLY (importScripts of a static, cacheable
 * file) so the UI thread never parses 10 MB of WASM glue or blocks on CV work.
 *
 * Requests are handled one at a time; the client drops live-camera frames while busy.
 */
import type { OMRTemplate } from "@/lib/omr/schema";
import { type CV, readyOpenCv } from "@/lib/vision/cv";
import { detectAlignment, scanSheet } from "@/lib/vision/scan-sheet";
import { type RgbaFrame, type ScanFrameInput, VisionError } from "@/lib/vision/types";
import { OPENCV_URL, type WorkerRequest, type WorkerResponse } from "@/lib/vision/worker-protocol";

// Typed view of the dedicated worker scope without pulling the conflicting "webworker" lib.
const ctx = self as unknown as {
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  importScripts(...urls: string[]): void;
  cv?: unknown;
};

let cvPromise: Promise<{ cv: CV; loadMs: number }> | null = null;
let template: OMRTemplate | null = null;

function loadCv() {
  cvPromise ??= (async () => {
    const t0 = performance.now();
    ctx.importScripts(OPENCV_URL);
    const { cv } = await readyOpenCv(ctx.cv);
    return { cv, loadMs: Math.round(performance.now() - t0) };
  })();
  return cvPromise;
}

async function toRgba(input: ScanFrameInput): Promise<RgbaFrame> {
  let bitmap: ImageBitmap | null = null;
  if (input.kind === "imageData") return { width: input.data.width, height: input.data.height, data: input.data.data };
  if (input.kind === "blob") bitmap = await createImageBitmap(input.blob, { imageOrientation: "from-image" });
  else if (input.kind === "imageBitmap") bitmap = input.bitmap;
  else bitmap = input.canvas.transferToImageBitmap();
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new VisionError("INVALID_INPUT", "2D canvas unavailable in worker");
    g.drawImage(bitmap, 0, 0);
    const img = g.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: img.width, height: img.height, data: img.data };
  } finally {
    bitmap.close();
  }
}

function grayToBitmap(img: { width: number; height: number; gray: Uint8Array }): ImageBitmap {
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.gray.length; i++, j += 4) {
    rgba[j] = rgba[j + 1] = rgba[j + 2] = img.gray[i];
    rgba[j + 3] = 255;
  }
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  return canvas.transferToImageBitmap();
}

const fail = (id: number, e: unknown): WorkerResponse => ({
  id, type: "error",
  error: e instanceof VisionError ? e.toJSON() : { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) },
});

ctx.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        const { loadMs } = await loadCv();
        ctx.postMessage({ id: msg.id, type: "ready", loadMs });
        break;
      }
      case "setTemplate":
        template = msg.template;
        ctx.postMessage({ id: msg.id, type: "ok" });
        break;
      case "align": {
        if (!template) throw new VisionError("INVALID_INPUT", "no template loaded");
        const { cv } = await loadCv();
        const frame = await toRgba(msg.frame);
        const { corners, telemetry } = detectAlignment(cv, frame, template);
        ctx.postMessage({ id: msg.id, type: "alignment", corners, telemetry, frameSize: { width: frame.width, height: frame.height } });
        break;
      }
      case "scan": {
        if (!template) throw new VisionError("INVALID_INPUT", "no template loaded");
        const { cv } = await loadCv();
        const frame = await toRgba(msg.frame);
        let preview: ImageBitmap | null = null;
        const result = scanSheet(cv, frame, template, {
          ...msg.options,
          onTelemetry: (telemetry) => ctx.postMessage({ id: msg.id, type: "telemetry", telemetry }),
          onCanonical: msg.preview ? (img) => { preview = grayToBitmap(img); } : undefined,
        });
        ctx.postMessage({ id: msg.id, type: "result", result, preview }, preview ? [preview] : []);
        break;
      }
    }
  } catch (err) {
    ctx.postMessage(fail(msg.id, err));
  }
};
