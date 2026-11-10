/**
 * QR identity check. The QR sits at the same template position on every page, so we warp
 * just that region straight from the FULL-RESOLUTION source (≈12 px/mm, not the 5 px/mm
 * canonical image — 0.5 mm modules need ≥ 3 px each) and decode it with jsQR.
 * QR decoding is rotation invariant, so an upside-down sheet is detected by looking at the
 * point-mirrored position of the QR in canonical space.
 */
import jsQR from "jsqr";
import { parseQrPayload } from "@/lib/omr/layout-engine";
import type { OMRTemplate } from "@/lib/omr/schema";
import type { CV, Mat } from "./cv";
import type { CanonicalFrame } from "./geometry";
import type { Mat3 } from "./types";

const QR_PX_PER_MM = 12;
const MARGIN_MM = 2;

function mul(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return r as unknown as Mat3;
}

/**
 * @param source        full-resolution grayscale frame
 * @param canonToSource canonical px → source px
 * @param mirrored      read the QR at the 180°-rotated position (sheet upside down)
 */
export function decodeQr(cv: CV, source: Mat, canonToSource: Mat3, template: OMRTemplate, frame: CanonicalFrame, mirrored: boolean): string | null {
  const b = template.pages[0].qr.bbox;
  const wMm = b.w + 2 * MARGIN_MM, hMm = b.h + 2 * MARGIN_MM;
  const k = frame.pxPerMm / QR_PX_PER_MM;
  // crop px (u, v) → canonical px
  let x0 = (b.x - MARGIN_MM + frame.padMm) * frame.pxPerMm;
  let y0 = (b.y - MARGIN_MM + frame.padMm) * frame.pxPerMm;
  let crop: Mat3 = [k, 0, x0, 0, k, y0, 0, 0, 1];
  if (mirrored) {
    x0 = frame.widthPx - 1 - x0;
    y0 = frame.heightPx - 1 - y0;
    crop = [-k, 0, x0, 0, -k, y0, 0, 0, 1];
  }
  const cropToSource = mul(canonToSource, crop);
  const W = Math.round(wMm * QR_PX_PER_MM), H = Math.round(hMm * QR_PX_PER_MM);
  const M = cv.matFromArray(3, 3, cv.CV_64F, Array.from(cropToSource));
  const out = new cv.Mat();
  const rgba = new cv.Mat();
  try {
    cv.warpPerspective(source, out, M, new cv.Size(W, H), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_REPLICATE, new cv.Scalar());
    cv.cvtColor(out, rgba, cv.COLOR_GRAY2RGBA);
    return jsQR(new Uint8ClampedArray(rgba.data), W, H, { inversionAttempts: "dontInvert" })?.data ?? null;
  } finally {
    M.delete(); out.delete(); rgba.delete();
  }
}

export function qrMatchesTemplate(payload: string | null, template: OMRTemplate) {
  const q = payload ? parseQrPayload(payload) : null;
  return {
    parsed: q,
    matches: !!q && q.templateId === template.templateId && q.version === template.version && q.layoutHash === template.layoutHash,
  };
}
