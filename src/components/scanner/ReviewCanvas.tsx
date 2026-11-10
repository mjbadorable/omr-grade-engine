"use client";

import { useEffect, useRef } from "react";
import type { ScanOutput } from "@/lib/vision/scan-sheet";
import type { BubbleState } from "@/lib/vision/types";

const COLORS: Record<BubbleState, string | null> = {
  FILLED: "rgba(22,163,74,.9)",
  PARTIAL: "rgba(234,88,12,.95)",
  ERASURE: "rgba(147,51,234,.9)",
  EMPTY: null,
};

/** De-warped sheet with per-bubble state rings and reference-mark residuals. */
export default function ReviewCanvas({ result, preview, highlight }: { result: ScanOutput; preview: ImageBitmap | null; highlight?: Set<string> }) {
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
  }, [result, preview, highlight]);

  return <canvas ref={ref} className="block h-auto w-full rounded-md bg-white shadow-sm" aria-label="De-warped sheet with detected marks" />;
}
