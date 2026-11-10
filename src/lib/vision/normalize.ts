/**
 * Lighting & contrast guardrail.
 *
 *  normalizeFrame   RGBA → grayscale, downscaled to ≤ maxLongEdge (INTER_AREA).
 *  fiducialBinary   Adaptive Gaussian threshold (ink → 255). Block size scales with the frame
 *                   so solid 6 mm fiducials stay solid while shadows/glare gradients cancel —
 *                   EvalBee uses one global Otsu threshold here, which fails under uneven light.
 *  inkDarkness      Continuous darkness map: 1 − gray / background, where background is a
 *                   morphological closing larger than any mark. Shadow-invariant, 0..255.
 */
import type { CV, Mat } from "./cv";
import { type RgbaFrame, VisionError } from "./types";

export const DEFAULT_MAX_LONG_EDGE = 1280;

export interface NormalizedFrame {
  gray: Mat;
  /** full-resolution grayscale (only with keepFull and when downscaled; otherwise null → use `gray`) */
  full: Mat | null;
  /** normalized px = input px × scale */
  scale: number;
  width: number;
  height: number;
}

export function rgbaToMat(cv: CV, frame: RgbaFrame): Mat {
  if (!frame || frame.width < 16 || frame.height < 16 || frame.data.length !== frame.width * frame.height * 4)
    throw new VisionError("INVALID_INPUT", "frame must be RGBA with width*height*4 bytes");
  const m = new cv.Mat(frame.height, frame.width, cv.CV_8UC4);
  m.data.set(frame.data);
  return m;
}

export function normalizeFrame(cv: CV, frame: RgbaFrame, maxLongEdge = DEFAULT_MAX_LONG_EDGE, keepFull = false): NormalizedFrame {
  const rgba = rgbaToMat(cv, frame);
  const full = new cv.Mat();
  try {
    cv.cvtColor(rgba, full, cv.COLOR_RGBA2GRAY);
  } finally {
    rgba.delete();
  }
  const long = Math.max(frame.width, frame.height);
  const scale = long > maxLongEdge ? maxLongEdge / long : 1;
  if (scale === 1) return { gray: full, full: null, scale, width: full.cols, height: full.rows };
  const gray = new cv.Mat();
  cv.resize(full, gray, new cv.Size(Math.round(frame.width * scale), Math.round(frame.height * scale)), 0, 0, cv.INTER_AREA);
  if (!keepFull) full.delete();
  return { gray, full: keepFull ? full : null, scale, width: gray.cols, height: gray.rows };
}

/** Odd block size ≈ 1/12 of the long edge: > 3× the largest fiducial at any sane framing. */
export function adaptiveBlockSize(width: number, height: number): number {
  const b = Math.max(31, Math.round(Math.max(width, height) / 12));
  return b % 2 ? b : b + 1;
}

export function fiducialBinary(cv: CV, gray: Mat, C = 12): Mat {
  const blurred = new cv.Mat();
  const bin = new cv.Mat();
  try {
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
    cv.adaptiveThreshold(blurred, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, adaptiveBlockSize(gray.cols, gray.rows), C);
    return bin;
  } catch (e) {
    bin.delete();
    throw e;
  } finally {
    blurred.delete();
  }
}

/** Background-normalised darkness (0 = paper, 255 = black ink). `kernelPx` must exceed the largest mark. */
export function inkDarkness(cv: CV, gray: Mat, kernelPx: number): Mat {
  // Illumination varies slowly, so the background is estimated at 1/4 resolution
  // (≈ 16× fewer pixels and a 4× smaller kernel) and upsampled: ~40 ms instead of ~2 s.
  const f = 4;
  const k = Math.max(3, Math.round(kernelPx / f) | 1);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
  const small = new cv.Mat();
  const bg = new cv.Mat();
  const out = new cv.Mat();
  try {
    cv.resize(gray, small, new cv.Size(Math.ceil(gray.cols / f), Math.ceil(gray.rows / f)), 0, 0, cv.INTER_AREA);
    // closing = dilate→erode: removes dark features smaller than k, keeps illumination
    cv.morphologyEx(small, small, cv.MORPH_CLOSE, kernel);
    cv.GaussianBlur(small, small, new cv.Size(k, k), 0);
    cv.resize(small, bg, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);
    cv.max(bg, gray, bg);                     // background never darker than the pixel itself
    cv.divide(gray, bg, out, 255);            // reflectance relative to local paper, 0..255
    cv.bitwise_not(out, out);                 // → darkness
    return out;
  } catch (e) {
    out.delete();
    throw e;
  } finally {
    kernel.delete();
    small.delete();
    bg.delete();
  }
}
