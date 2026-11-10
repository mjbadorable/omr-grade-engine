/** Message contract between the UI thread and the OMR scanner worker (structured-clone safe). */
import type { OMRTemplate } from "@/lib/omr/schema";
import type { ScanOutput } from "./scan-sheet";
import type { CornerPoints, ScanFrameInput, ScanOptions, ScanTelemetry, VisionErrorPayload } from "./types";

export const OPENCV_VERSION = "4.10.0-release.1";
export const OPENCV_URL = `/vendor/opencv-${OPENCV_VERSION}.js`;

export type WorkerScanOptions = Omit<ScanOptions, "onTelemetry" | "onCanonical">;

export type WorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "setTemplate"; template: OMRTemplate }
  | { id: number; type: "align"; frame: ScanFrameInput }
  | { id: number; type: "scan"; frame: ScanFrameInput; options?: WorkerScanOptions; preview?: boolean };

export type WorkerResponse =
  | { id: number; type: "ready"; loadMs: number }
  | { id: number; type: "ok" }
  | { id: number; type: "telemetry"; telemetry: ScanTelemetry }
  | { id: number; type: "alignment"; corners: CornerPoints | null; telemetry: ScanTelemetry; frameSize: { width: number; height: number } }
  | { id: number; type: "result"; result: ScanOutput; preview: ImageBitmap | null }
  | { id: number; type: "error"; error: VisionErrorPayload };
