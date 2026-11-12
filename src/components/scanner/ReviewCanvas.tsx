"use client";

import { useEffect, useRef } from "react";
import type { OMRTemplate } from "@/lib/omr/schema";
import { overlayGeometry, RING_STYLE, ringClass } from "@/lib/vision/diagnostics";
import type { ScanOutput } from "@/lib/vision/scan-sheet";
import type { BubbleState } from "@/lib/vision/types";

const COLORS: Record<BubbleState, string | null> = {
  FILLED: "rgba(22,163,74,.9)",
  PARTIAL: "rgba(234,88,12,.95)",
  ERASURE: "rgba(147,51,234,.9)",
  EMPTY: null,
};

/**
 * De-warped sheet with per-bubble state rings and reference-mark residuals.
 * With `diagnostics` (field calibration) it also draws the 4 registration squares, the anti-curl
 * reference band lines and a colour-coded ring on EVERY bubble (green / yellow / red).
 */
export default function ReviewCanvas({ result, preview, highlight, diagnostics, template }: { result: ScanOutput; preview: ImageBitmap | null; highlight?: Set<string>; diagnostics?: boolean; template?: OMRTemplate | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { widthPx: w, heightPx: h, pxPerMm } = result.canonical;
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    if (preview) g.drawImage(preview, 0, 0, w, h);
    const r = pxPerMm * 2.6; // ring just outside a ~4 mm bubble

    if (diagnostics) {
      if (template) {
        const geo = overlayGeometry(template, result);
        // anti-curl reference bands: a line through every row of reference marks (detected positions)
        g.lineWidth = 1.5;
        for (const band of geo.bands) {
          g.strokeStyle = "rgba(37,99,235,.65)";
          g.beginPath();
          band.marks.forEach((m, i) => (i ? g.lineTo(m.detected.x, m.detected.y) : g.moveTo(m.detected.x, m.detected.y)));
          g.stroke();
          g.setLineDash([3, 4]);
          g.strokeStyle = "rgba(37,99,235,.3)";
          g.beginPath();
          band.marks.forEach((m, i) => (i ? g.lineTo(m.expected.x, m.expected.y) : g.moveTo(m.expected.x, m.expected.y)));
          g.stroke();
          g.setLineDash([]);
        }
        // the four outer registration squares
        g.lineWidth = 3;
        g.font = `${Math.round(pxPerMm * 3)}px sans-serif`;
        for (const c4 of geo.corners) {
          const half = c4.sizePx / 2 + 6;
          g.strokeStyle = "rgba(22,163,74,1)";
          g.strokeRect(c4.center.x - half, c4.center.y - half, half * 2, half * 2);
          g.fillStyle = "rgba(22,163,74,1)";
          g.fillText(c4.id.toUpperCase(), c4.center.x + half + 4, c4.center.y + half);
        }
      }
      g.lineWidth = 2;
      for (const b of result.bubbles) {
        g.strokeStyle = RING_STYLE[ringClass(b)].color;
        g.beginPath();
        g.arc(b.center.x, b.center.y, r, 0, Math.PI * 2);
        g.stroke();
      }
      for (const m of result.referenceMarks) {
        g.beginPath();
        g.arc(m.detected.x, m.detected.y, 3, 0, Math.PI * 2);
        g.fillStyle = m.found ? "rgba(37,99,235,.95)" : "rgba(220,38,38,.95)";
        g.fill();
      }
      return;
    }

    for (const b of result.bubbles) {
      const col = COLORS[b.state];
      const hot = highlight?.has(b.bubbleId);
      if (!col && !hot) continue;
      g.beginPath();
      g.arc(b.center.x, b.center.y, r, 0, Math.PI * 2);
      g.lineWidth = hot ? 3 : 2;
      g.strokeStyle = hot ? "rgba(220,38,38,1)" : col!;
      g.stroke();
    }
    for (const m of result.referenceMarks) {
      g.beginPath();
      g.arc(m.detected.x, m.detected.y, 3, 0, Math.PI * 2);
      g.fillStyle = m.found ? "rgba(37,99,235,.9)" : "rgba(220,38,38,.9)";
      g.fill();
    }
  }, [result, preview, highlight, diagnostics, template]);

  return <canvas ref={ref} className="block h-auto w-full rounded-md bg-white shadow-sm" aria-label="De-warped sheet with detected marks" />;
}
