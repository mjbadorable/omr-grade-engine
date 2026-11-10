"use client";

import { memo, useMemo } from "react";
import { collectBubbles } from "@/lib/omr/layout-engine";
import { pagePrimitives } from "@/lib/omr/primitives";
import type { OMRTemplate } from "@/lib/omr/schema";

export interface PreviewOverlays {
  cells: boolean;
  bboxes: boolean;
}

/**
 * Vector preview in PAGE millimetres (1 SVG user unit = 1 mm). Rendered from the same
 * primitive list as the PDF, so what you see is what prints.
 */
function SheetPreviewImpl({ template, pageIndex, overlays }: { template: OMRTemplate; pageIndex: number; overlays: PreviewOverlays }) {
  const page = template.pages[pageIndex];
  const prims = useMemo(() => pagePrimitives(template, page), [template, page]);
  const [ox, oy] = template.paper.originMm;
  const { widthMm: W, heightMm: H } = template.paper;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_24px_rgba(0,0,0,.08)]"
      role="img"
      aria-label={`Answer sheet preview, page ${pageIndex + 1}`}
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      {/* printable-area guide */}
      <rect x={template.paper.minPrintMarginMm} y={template.paper.minPrintMarginMm}
        width={W - 2 * template.paper.minPrintMarginMm} height={H - 2 * template.paper.minPrintMarginMm}
        fill="none" stroke="#e3e6ec" strokeWidth={0.2} strokeDasharray="1.5 1.5" />

      {overlays.cells && (
        <g>
          {page.referenceGrid.rowYs.slice(0, -1).map((y, ri) =>
            page.referenceGrid.columnXs.slice(0, -1).map((x, ci) => (
              <rect key={`${ri}-${ci}`} x={x + ox} y={y + oy}
                width={page.referenceGrid.columnXs[ci + 1] - x} height={page.referenceGrid.rowYs[ri + 1] - y}
                fill={ri % 2 ? "rgba(56,132,255,.07)" : "rgba(255,153,51,.08)"} stroke="rgba(56,132,255,.45)" strokeWidth={0.15} />
            )),
          )}
        </g>
      )}

      {prims.map((p, i) => {
        switch (p.t) {
          case "rect":
            return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill ?? "none"} stroke={p.stroke} strokeWidth={p.strokeW} shapeRendering={p.fill ? "crispEdges" : undefined} />;
          case "circle":
            return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill="none" stroke={p.stroke} strokeWidth={p.strokeW} />;
          case "line":
            return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeWidth={p.strokeW} />;
          case "text":
            return (
              <text key={i} x={p.x} y={p.y} fontSize={p.size} fontWeight={p.bold ? 700 : 400} textAnchor={p.anchor}
                fill={p.fill} fontFamily="Helvetica, Arial, sans-serif">
                {p.text}
              </text>
            );
        }
      })}

      {overlays.bboxes && (
        <g>
          {page.regions.map((r) => (
            <rect key={r.id} x={r.bbox.x + ox - 0.6} y={r.bbox.y + oy - 0.6} width={r.bbox.w + 1.2} height={r.bbox.h + 1.2}
              fill="none" stroke="#7c3aed" strokeWidth={0.2} strokeDasharray="1 0.8">
              <title>{r.id}</title>
            </rect>
          ))}
          {page.texts.map((t) => (
            <rect key={t.id} x={t.bbox.x + ox} y={t.bbox.y + oy} width={t.bbox.w} height={t.bbox.h}
              fill="rgba(16,185,129,.12)" stroke="rgba(16,185,129,.7)" strokeWidth={0.1} />
          ))}
          {collectBubbles(page).map((b) => (
            <rect key={b.id} x={b.bbox.x + ox} y={b.bbox.y + oy} width={b.bbox.w} height={b.bbox.h}
              fill="rgba(37,99,235,.08)" stroke="rgba(37,99,235,.6)" strokeWidth={0.1}>
              <title>{`${b.id}  centre (${b.center[0]}, ${b.center[1]}) mm  cell [${b.cell.join(",")}]`}</title>
            </rect>
          ))}
          {page.referenceGrid.marks.flat().map((m) => (
            <circle key={m.id} cx={m.center[0] + ox} cy={m.center[1] + oy} r={0.6} fill="#ef4444">
              <title>{`${m.id} (${m.center[0]}, ${m.center[1]}) mm`}</title>
            </circle>
          ))}
        </g>
      )}
    </svg>
  );
}

const SheetPreview = memo(SheetPreviewImpl);
export default SheetPreview;
