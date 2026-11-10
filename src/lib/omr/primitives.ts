/**
 * Template → device-independent draw list, in PAGE millimetres (y down).
 * Both the SVG preview and the PDF exporter render exclusively from this list, so the
 * preview is exactly what prints.
 */
import { collectBubbles } from "./layout-engine";
import type { OMRPage, OMRTemplate } from "./schema";

export const INK = {
  solid: "#000000",
  bubbleStroke: "#262626",
  bubbleLabel: "#a3a3a3",   // light: printed letters read ≈ 0.36 darkness, well under the 0.5 ink level
  text: "#111111",
  box: "#6b6b6b",
} as const;

export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeW?: number }
  | { t: "circle"; cx: number; cy: number; r: number; stroke: string; strokeW: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeW: number }
  | { t: "text"; x: number; y: number; text: string; size: number; bold: boolean; anchor: "start" | "middle" | "end"; fill: string; maxW: number };

export function pagePrimitives(t: OMRTemplate, page: OMRPage): Prim[] {
  const [ox, oy] = t.paper.originMm;
  const P = (x: number) => x + ox;
  const Q = (y: number) => y + oy;
  const out: Prim[] = [];

  // fiducials
  for (const f of [page.fiducials.tl, page.fiducials.tr, page.fiducials.br, page.fiducials.bl])
    out.push({ t: "rect", x: P(f.bbox.x), y: Q(f.bbox.y), w: f.bbox.w, h: f.bbox.h, fill: INK.solid });

  // reference grid marks (corners are the fiducials)
  for (const m of page.referenceGrid.marks.flat())
    if (!m.isFiducial) out.push({ t: "rect", x: P(m.bbox.x), y: Q(m.bbox.y), w: m.bbox.w, h: m.bbox.h, fill: INK.solid });

  // QR code: merge horizontal runs of dark modules into one rect each (fewer PDF ops, no hairline seams)
  const qr = page.qr;
  const rows = qr.matrix.split("/");
  const x0 = qr.bbox.x + qr.quietZoneModules * qr.moduleSizeMm;
  const y0 = qr.bbox.y + qr.quietZoneModules * qr.moduleSizeMm;
  rows.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c] !== "1") { c++; continue; }
      const start = c;
      while (c < row.length && row[c] === "1") c++;
      out.push({ t: "rect", x: P(x0 + start * qr.moduleSizeMm), y: Q(y0 + r * qr.moduleSizeMm), w: (c - start) * qr.moduleSizeMm, h: qr.moduleSizeMm, fill: INK.solid });
    }
  });

  // boxes and field lines
  for (const b of page.boxes) {
    if (b.kind === "field-line") out.push({ t: "line", x1: P(b.bbox.x), y1: Q(b.bbox.y), x2: P(b.bbox.x + b.bbox.w), y2: Q(b.bbox.y), stroke: INK.box, strokeW: 0.2 });
    else out.push({ t: "rect", x: P(b.bbox.x), y: Q(b.bbox.y), w: b.bbox.w, h: b.bbox.h, stroke: INK.box, strokeW: 0.2 });
  }

  // texts
  for (const tx of page.texts) {
    const anchor = tx.align === "left" ? "start" : tx.align === "right" ? "end" : "middle";
    const x = tx.align === "left" ? tx.bbox.x : tx.align === "right" ? tx.bbox.x + tx.bbox.w : tx.bbox.x + tx.bbox.w / 2;
    out.push({ t: "text", x: P(x), y: Q(tx.bbox.y + tx.fontSizeMm * 0.93), text: tx.text, size: tx.fontSizeMm, bold: tx.weight === "bold", anchor, fill: INK.text, maxW: tx.bbox.w * 1.05 + 0.5 });
  }

  // bubbles
  const r = t.bubble.diameterMm / 2;
  const labelSize = t.bubble.diameterMm * 0.5;
  for (const b of collectBubbles(page)) {
    out.push({ t: "circle", cx: P(b.center[0]), cy: Q(b.center[1]), r: r - t.bubble.strokeMm / 2, stroke: INK.bubbleStroke, strokeW: t.bubble.strokeMm });
    out.push({ t: "text", x: P(b.center[0]), y: Q(b.center[1] + labelSize * 0.36), text: b.label, size: labelSize, bold: false, anchor: "middle", fill: INK.bubbleLabel, maxW: t.bubble.diameterMm * 0.8 });
  }

  // footer: identity for humans (outside the scanned area, inside printable margin)
  out.push({
    t: "text", x: P(t.sheet.widthMm / 2), y: Q(t.sheet.heightMm) + Math.min(4, (t.paper.heightMm - Q(t.sheet.heightMm) - t.paper.minPrintMarginMm)) ,
    text: `${t.templateId} · v${t.version} · ${t.layoutHash} · page ${page.index + 1}/${t.pages.length}`,
    size: 1.8, bold: false, anchor: "middle", fill: INK.bubbleLabel, maxW: t.sheet.widthMm - 20,
  });
  return out;
}
