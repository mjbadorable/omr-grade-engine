import { createRequire } from "node:module";
import type { CV } from "@/lib/vision/cv";
import { readyOpenCv } from "@/lib/vision/cv";

let pending: Promise<{ cv: CV }> | null = null;

/** Load the OpenCV.js WASM build in Node once per test worker. */
export async function loadCv(): Promise<CV> {
  pending ??= readyOpenCv(createRequire(import.meta.url)("@techstark/opencv-js"));
  return (await pending).cv;
}
