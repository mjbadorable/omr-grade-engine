/**
 * Print-time options (pure). None of these change the template or its layoutHash: they only
 * decide how the same draw list is inked and placed, so any printout still scans against the
 * same template.
 */
import { INK, type Prim } from "./primitives";
import type { OMRTemplate } from "./schema";

export type Darkness = "standard" | "high";
export type PerPage = 1 | 2 | 4;
export const PER_PAGE_OPTIONS: readonly PerPage[] = [1, 2, 4];

/** Photocopy-safe: black, slightly heavier outlines. Bubble letters stay light (they must never read as marks). */
export function applyDarkness(prims: readonly Prim[], darkness: Darkness): Prim[] {
  if (darkness === "standard") return [...prims];
  const heavier = (w: number) => Math.round(w * 1.4 * 1000) / 1000;
  return prims.map((p): Prim => {
    switch (p.t) {
      case "circle": return { ...p, stroke: INK.solid, strokeW: heavier(p.strokeW) };
      case "line": return { ...p, stroke: INK.solid, strokeW: heavier(p.strokeW) };
      case "rect": return p.stroke ? { ...p, stroke: INK.solid, strokeW: heavier(p.strokeW ?? 0.2) } : p;
      case "text": return p.fill === INK.text ? { ...p, fill: INK.solid } : p;
    }
  });
}

export interface Box { x: number; y: number; w: number; h: number }

/** The registered sheet area plus a small quiet margin (clamped to the paper), in paper mm. */
export function sheetCrop(t: OMRTemplate, padMm = 4): Box {
  const [ox, oy] = t.paper.originMm;
  const x = Math.max(0, ox - padMm), y = Math.max(0, oy - padMm);
  const right = Math.min(t.paper.widthMm, ox + t.sheet.widthMm + padMm);
  const bottom = Math.min(t.paper.heightMm, oy + t.sheet.heightMm + padMm);
  return { x, y, w: right - x, h: bottom - y };
}

export interface Cell { x: number; y: number; scale: number }
export interface NUpLayout { pageWidthMm: number; pageHeightMm: number; cells: Cell[]; /** divider lines, page mm */ cuts: { x1: number; y1: number; x2: number; y2: number }[] }

/**
 * 1-up: the paper itself. 2-up: landscape page, two cells side by side. 4-up: portrait page, 2×2.
 * Sheets are scaled uniformly (so the corner marks keep their exact proportions) and centred in their cell.
 */
export function nUpLayout(paper: { widthMm: number; heightMm: number }, crop: Box, perPage: PerPage): NUpLayout {
  if (perPage === 1) return { pageWidthMm: paper.widthMm, pageHeightMm: paper.heightMm, cells: [{ x: 0, y: 0, scale: 1 }], cuts: [] };
  const long = Math.max(paper.widthMm, paper.heightMm), short = Math.min(paper.widthMm, paper.heightMm);
  const cols = 2, rows = perPage === 2 ? 1 : 2;
  const pageW = perPage === 2 ? long : short, pageH = perPage === 2 ? short : long;
  const cw = pageW / cols, ch = pageH / rows;
  const scale = Math.min(cw / crop.w, ch / crop.h);
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: c * cw + (cw - crop.w * scale) / 2, y: r * ch + (ch - crop.h * scale) / 2, scale });
  const cuts: NUpLayout["cuts"] = [{ x1: cw, y1: 0, x2: cw, y2: pageH }];
  if (rows === 2) cuts.push({ x1: 0, y1: ch, x2: pageW, y2: ch });
  return { pageWidthMm: pageW, pageHeightMm: pageH, cells, cuts };
}
