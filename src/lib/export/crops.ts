/**
 * Verification crops (browser only): cut the roll-number grid and the signature line out of the
 * stored de-warped page image. Template mm → canonical px → preview px.
 */
import type { OMRTemplate } from "@/lib/omr/schema";
import type { ScanOutput } from "@/lib/vision/scan-sheet";
import type { ImageCrop } from "./scorecard-generator";

type Region = { x: number; y: number; w: number; h: number }; // template mm

export function cropRegions(t: OMRTemplate): { roll: Region | null; signature: Region | null } {
  const page = t.pages[0];
  const roll = page.regions.find((r) => r.kind === "roll");
  const rollLabel = page.texts.find((x) => x.id === "p0:roll:label");
  const line = page.boxes.find((b) => b.id === "p0:field:signature:line");
  const label = page.texts.find((x) => x.id === "p0:field:signature");
  const p = t.bubble.rowPitchMm;
  return {
    roll: roll ? pad({ x: roll.bbox.x, y: rollLabel ? rollLabel.bbox.y : roll.bbox.y, w: roll.bbox.w, h: roll.bbox.y + roll.bbox.h - (rollLabel ? rollLabel.bbox.y : roll.bbox.y) }, 1.5) : null,
    signature: line ? pad({ x: label ? label.bbox.x : line.bbox.x, y: line.bbox.y - 2.2 * p, w: line.bbox.x + line.bbox.w - (label ? label.bbox.x : line.bbox.x), h: 2.2 * p + 1 }, 1) : null,
  };
}
const pad = (r: Region, m: number): Region => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

export async function cropFromPreview(preview: Blob, scan: ScanOutput, region: Region): Promise<ImageCrop> {
  const bmp = await createImageBitmap(preview);
  try {
    const k = bmp.width / scan.canonical.widthPx;
    const toPx = (mm: number) => (mm + scan.canonical.padMm) * scan.canonical.pxPerMm * k;
    const sx = Math.max(0, toPx(region.x)), sy = Math.max(0, toPx(region.y));
    const sw = Math.min(bmp.width - sx, region.w * scan.canonical.pxPerMm * k), sh = Math.min(bmp.height - sy, region.h * scan.canonical.pxPerMm * k);
    const scale = Math.min(3, 600 / sw);
    const c = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    c.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "jpeg" };
  } finally {
    bmp.close();
  }
}
