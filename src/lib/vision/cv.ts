/**
 * OpenCV is injected, never imported, by the pipeline modules: the worker passes the
 * browser build, tests pass the Node build. This file only holds types and a Mat tracker.
 */
import type * as OpenCV from "@techstark/opencv-js";

export type CV = typeof OpenCV;
export type Mat = OpenCV.Mat;

/** Collects WASM-heap objects and frees them deterministically (OpenCV.js has no GC for Mats). */
export class MatScope {
  private items: { delete(): void; isDeleted?: () => boolean }[] = [];
  track<T extends { delete(): void }>(m: T): T {
    this.items.push(m);
    return m;
  }
  /** Stop tracking `m` (ownership moves to the caller). */
  release<T extends { delete(): void }>(m: T): T {
    this.items = this.items.filter((x) => x !== m);
    return m;
  }
  dispose() {
    for (const m of this.items.reverse()) {
      try { if (!m.isDeleted || !m.isDeleted()) m.delete(); } catch { /* already freed */ }
    }
    this.items = [];
  }
}

/**
 * Wait for an Emscripten OpenCV module to finish initialising.
 * The module object is "thenable" and resolves to itself, so awaiting it (or returning it
 * from an async function) never settles. We wait on onRuntimeInitialized, strip `then`, and
 * hand the module out inside a wrapper object.
 */
export function readyOpenCv(mod: unknown): Promise<{ cv: CV }> {
  const m = mod as CV & { then?: unknown; onRuntimeInitialized?: () => void; calledRun?: boolean };
  const finish = () => {
    if ("then" in m) delete (m as { then?: unknown }).then;
    return { cv: m as CV };
  };
  if (typeof m.Mat === "function") return Promise.resolve(finish());
  return new Promise((resolve) => {
    const prev = m.onRuntimeInitialized;
    m.onRuntimeInitialized = () => { prev?.(); resolve(finish()); };
  });
}

export function assertReady(cv: CV | undefined | null): asserts cv is CV {
  if (!cv || typeof (cv as { Mat?: unknown }).Mat !== "function") {
    throw Object.assign(new Error("OpenCV runtime is not initialised"), { code: "OPENCV_NOT_READY" });
  }
}
