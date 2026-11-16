/**
 * PNG export of one sheet page (for Word / exam booklets). Renders the same draw list the PDF and
 * the preview use, cropped to the sheet area, so what you embed is what the scanner expects.
 */
import { applyDarkness, type Darkness, sheetCrop } from "./print-options";
import { pagePrimitives, type Prim } from "./primitives";
import type { OMRTemplate } from "./schema";

type Ctx = Pick<CanvasRenderingContext2D, "fillRect" | "strokeRect" | "beginPath" | "arc" | "stroke" | "moveTo" | "lineTo" | "fillText" | "save" | "restore"> &
  { fillStyle: unknown; strokeStyle: unknown; lineWidth: number; font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline };

/** Draw prims (mm) onto a canvas context at `pxPerMm`, relative to `origin` (mm). */
export function drawPrimsToContext(ctx: Ctx, prims: readonly Prim[], pxPerMm: number, origin: { x: number; y: number }): void {
  const X = (v: number) => (v - origin.x) * pxPerMm;
  const Y = (v: number) => (v - origin.y) * pxPerMm;
  for (const p of prims) {
    switch (p.t) {
      case "rect":
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fillRect(X(p.x), Y(p.y), p.w * pxPerMm, p.h * pxPerMm); }
        if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = (p.strokeW ?? 0.2) * pxPerMm; ctx.strokeRect(X(p.x), Y(p.y), p.w * pxPerMm, p.h * pxPerMm); }
        break;
      case "circle":
        ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeW * pxPerMm;
        ctx.beginPath(); ctx.arc(X(p.cx), Y(p.cy), p.r * pxPerMm, 0, Math.PI * 2); ctx.stroke();
        break;
      case "line":
        ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeW * pxPerMm;
        ctx.beginPath(); ctx.moveTo(X(p.x1), Y(p.y1)); ctx.lineTo(X(p.x2), Y(p.y2)); ctx.stroke();
        break;
      case "text":
        ctx.fillStyle = p.fill;
        ctx.font = `${p.bold ? "bold " : ""}${p.size * pxPerMm}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = p.anchor === "start" ? "left" : p.anchor === "end" ? "right" : "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.text, X(p.x), Y(p.y), p.maxW * pxPerMm);   // maxWidth = shrink-to-fit, like the PDF
        break;
    }
  }
}

/** One page as a PNG blob (browser only). Default 200 dpi is crisp on screen and prints well. */
export async function renderPagePng(template: OMRTemplate, pageIndex: number, opts: { dpi?: number; darkness?: Darkness } = {}): Promise<Blob> {
  const page = template.pages[Math.min(Math.max(0, pageIndex), template.pages.length - 1)];
  const pxPerMm = (opts.dpi ?? 200) / 25.4;
  const crop = sheetCrop(template);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.w * pxPerMm);
  canvas.height = Math.round(crop.h * pxPerMm);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PNG export is not available in this browser");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawPrimsToContext(ctx, applyDarkness(pagePrimitives(template, page), opts.darkness ?? "standard"), pxPerMm, crop);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
}
