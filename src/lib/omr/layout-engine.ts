/**
 * Deterministic OMR layout solver.
 *
 *   settings ──► computeLayout() ──► OMRTemplate (mm, fiducial-relative) + validation issues
 *
 * Pure and synchronous: the same settings always yield byte-identical JSON and the same
 * layoutHash (no Date, no Math.random, no font measurement from the environment).
 *
 * Vertical rhythm: every answer row sits on a global row pitch `p`. The anti-curl reference
 * grid has a row of marks every 5 rows (one "band"), so each band holds exactly five answer
 * rows and every bubble belongs to exactly one band/cell.
 */
import qrcode from "qrcode-generator";
import {
  type Bubble,
  type BoxItem,
  type CellRef,
  type LayoutSettings,
  LayoutSettingsSchema,
  type Mark,
  type McqRegion,
  type OMRPage,
  type OMRTemplate,
  OMRTemplateSchema,
  PAPER_SIZES,
  type Rect,
  type Region,
  type SectionSettings,
  TEMPLATE_SCHEMA_ID,
  type TextItem,
} from "./schema";
import { canonicalJson, sha256Hex } from "./sha256";

export const LAYOUT_CONSTANTS = {
  minPrintMarginMm: 6,       // most office printers cannot print closer than ~5 mm
  fiducialSizeMm: 6,
  fiducialQuietZoneMm: 2,    // nothing may be printed this close to a fiducial
  markSizeMm: 3,             // reference-grid mark (square)
  bubbleRowsPerCell: 5,      // grid row every 5 answer rows (EvalBee-compatible rhythm)
  minClearanceMm: 0.3,       // minimum gap between any two printed elements
  gutterMm: 5,               // between answer columns
  blockGapMm: 6,             // between header blocks
  qrModuleMm: 0.5,
  qrQuietModules: 4,
  qrErrorCorrection: "M" as const,
  strokeMm: 0.25,
  innerSampleRatio: 0.7,
  rowExtraMm: 1.4,           // row pitch = d + rowExtra
  optionExtraMm: 1.3,        // option pitch = d + optionExtra
} as const;

const C = LAYOUT_CONSTANTS;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const EPS = 1e-6;

export type IssueSeverity = "error" | "warning";
export interface LayoutIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  page?: number;
  ids?: string[];
}
export interface LayoutResult {
  template: OMRTemplate;
  issues: LayoutIssue[];
  stats: { pages: number; bubbles: number; questions: number; marksPerPage: number };
}

// ------------------------------------------------------------------ label helpers
const LETTERS = "ABCDEFGHIJ".split("");
const MATRIX_COLS = "PQRSTU".split("");

function optionLabels(section: Extract<SectionSettings, { type: "mcq" }>): string[] {
  if (section.optionStyle === "true-false") return ["T", "F"];
  if (section.optionStyle === "numbers") return Array.from({ length: section.optionCount }, (_, i) => String(i + 1));
  return LETTERS.slice(0, section.optionCount);
}

/** WinAnsi-safe text (pdf-lib standard fonts) + conservative width estimate (Helvetica ≈ 0.55 em). */
export function sanitizeText(s: string): string {
  return s.replace(/[–—]/g, "-").replace(/[^\x20-\x7E -ÿ…]/g, "?");
}
export function estimateTextWidthMm(text: string, fontSizeMm: number, bold: boolean): number {
  return text.length * fontSizeMm * (bold ? 0.6 : 0.55);
}
function fitText(text: string, fontSizeMm: number, bold: boolean, maxW: number): string {
  let t = sanitizeText(text);
  if (estimateTextWidthMm(t, fontSizeMm, bold) <= maxW) return t;
  while (t.length > 1 && estimateTextWidthMm(t + "…", fontSizeMm, bold) > maxW) t = t.slice(0, -1);
  return t + "…";
}

// ------------------------------------------------------------------ geometry
interface Geometry {
  paperW: number; paperH: number;
  originX: number; originY: number;
  sheetW: number; sheetH: number;
  bands: number; bandH: number; totalRows: number;
  d: number; p: number; q: number;
  xL: number; xR: number;
  rowYs: number[]; columnXs: number[];
}

function buildGeometry(s: LayoutSettings): Geometry {
  const paper = PAPER_SIZES[s.paper];
  const d = r3(s.bubbleDiameterMm);
  const p = r3(d + C.rowExtraMm);
  const q = r3(d + C.optionExtraMm);
  const bandH = r3(p * C.bubbleRowsPerCell);
  const edge = C.minPrintMarginMm + C.fiducialSizeMm / 2;     // fiducial centre ≥ this from paper edge
  const sheetW = r3(paper.widthMm - 2 * edge);
  const bands = Math.floor((paper.heightMm - 2 * edge) / bandH + EPS);
  const sheetH = r3(bands * bandH);
  const originY = r3((paper.heightMm - sheetH) / 2);          // centre vertically, equal margins
  const xL = r3(C.fiducialSizeMm / 2 + C.fiducialQuietZoneMm + 0.5);
  const xR = r3(sheetW - xL);
  return {
    paperW: paper.widthMm, paperH: paper.heightMm,
    originX: edge, originY,
    sheetW, sheetH, bands, bandH, totalRows: bands * C.bubbleRowsPerCell,
    d, p, q, xL, xR,
    rowYs: Array.from({ length: bands + 1 }, (_, i) => r3(i * bandH)),
    columnXs: [0, sheetW],
  };
}

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: r3(x), y: r3(y), w: r3(w), h: r3(h) });
const centredSquare = (cx: number, cy: number, size: number) => rect(cx - size / 2, cy - size / 2, size, size);

function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return rect(x0, y0, x1 - x0, y1 - y0);
}

function cellOf(g: Geometry, x: number, y: number): CellRef {
  const find = (edges: number[], v: number) => {
    for (let i = 0; i < edges.length - 1; i++) if (v < edges[i + 1]) return i;
    return edges.length - 2;
  };
  return [Math.max(0, find(g.rowYs, y)), Math.max(0, find(g.columnXs, x))];
}

// ------------------------------------------------------------------ QR
function qrModules(payload: string): boolean[][] {
  const qr = qrcode(0, C.qrErrorCorrection);
  qr.addData(payload, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
export function qrPayload(templateId: string, version: number, page: number, pages: number, hash: string) {
  return `OMR1;${templateId};${version};${page};${pages};${hash}`;
}
export function parseQrPayload(s: string) {
  const m = /^OMR1;([^;]+);(\d+);(\d+);(\d+);([0-9a-f]{16})$/.exec(s);
  return m ? { templateId: m[1], version: +m[2], page: +m[3], pages: +m[4], layoutHash: m[5] } : null;
}

// ------------------------------------------------------------------ page builder
class PageBuilder {
  texts: TextItem[] = [];
  boxes: BoxItem[] = [];
  regions: Region[] = [];
  constructor(readonly index: number, readonly g: Geometry) {}

  rowCenter(row: number) { return r3(row * this.g.p + this.g.p / 2); }

  bubble(id: string, label: string, cx: number, cy: number): Bubble {
    return { id: `p${this.index}:${id}`, label, center: [r3(cx), r3(cy)], bbox: centredSquare(cx, cy, this.g.d), cell: cellOf(this.g, cx, cy) };
  }

  text(id: string, text: string, x: number, row: number, maxW: number, fontSizeMm: number,
       weight: "normal" | "bold" = "normal", align: "left" | "center" | "right" = "left"): TextItem {
    const t = fitText(text, fontSizeMm, weight === "bold", maxW);
    const w = Math.min(maxW, estimateTextWidthMm(t, fontSizeMm, weight === "bold"));
    const h = fontSizeMm * 1.15;
    const cy = this.rowCenter(row);
    const x0 = align === "left" ? x : align === "right" ? x + maxW - w : x + (maxW - w) / 2;
    const item: TextItem = { id: `p${this.index}:${id}`, text: t, fontSizeMm: r3(fontSizeMm), weight, align, bbox: rect(x0, cy - h / 2, w, h) };
    this.texts.push(item);
    return item;
  }

  writeBox(id: string, cx: number, row: number): BoxItem {
    const { p, q } = this.g;
    const b: BoxItem = { id: `p${this.index}:${id}`, kind: "write-box", bbox: rect(cx - (q - 0.9) / 2, this.rowCenter(row) - (p - 0.9) / 2, q - 0.9, p - 0.9) };
    this.boxes.push(b);
    return b;
  }
}

// ------------------------------------------------------------------ header
interface HeaderResult { headerRows: number }

function layoutHeader(pb: PageBuilder, s: LayoutSettings, qrSize: number, pageCount: number): HeaderResult {
  const { g } = pb;
  const qrRows = Math.ceil(qrSize / g.p - EPS);
  const qrX = g.xR - qrSize;
  const title = s.title.trim() || "Answer Sheet";
  const titleFont = Math.min(4.2, g.p * 0.75);
  const labelFont = Math.min(2.4, g.p * 0.45);
  const instructionsFor = (maxW: number) => {
    const font = Math.min(2.3, g.p * 0.42);
    const variants = [
      "Use a dark pen or HB pencil. Fill bubbles completely. Print at 100% scale.",
      "Dark pen/HB pencil. Fill bubbles fully. Print at 100%.",
    ];
    return variants.find((v) => estimateTextWidthMm(v, font, false) <= maxW) ?? variants[1];
  };

  if (pb.index > 0) {
    pb.text("title", `${title} - page ${pb.index + 1} of ${pageCount}`, g.xL, 0.5, qrX - C.blockGapMm - g.xL, Math.min(3.2, g.p * 0.6), "bold");
    return { headerRows: Math.max(qrRows, 2) };
  }

  const rollW = s.rollDigits > 0 ? Math.max(s.rollDigits * g.q, estimateTextWidthMm("ROLL NUMBER", labelFont, true)) : 0;
  const setW = s.examSets >= 2 ? Math.max(s.examSets * g.q, estimateTextWidthMm("SET", labelFont, true)) : 0;
  const infoX = g.xL + (rollW ? rollW + C.blockGapMm : 0) + (setW ? setW + C.blockGapMm : 0);
  // Compact header: title, instructions and name lines sit beside the roll grid (saves a band).
  // Fallback when that column is too narrow: title band on top, identity blocks below.
  const compact = qrX - C.blockGapMm - infoX >= 50;
  const top = compact ? 0 : Math.max(4, qrRows);
  /** Right edge available to a text/line on `row` (stays clear of the QR on its rows). */
  const rightEdge = (row: number) => (row * g.p >= qrSize + C.minClearanceMm ? g.xR : qrX - C.blockGapMm);

  let infoRows: number;
  if (compact) {
    pb.text("title", title, infoX, 0.5, rightEdge(1) - infoX, titleFont, "bold");
    if (s.subtitle.trim()) pb.text("subtitle", s.subtitle, infoX, 2, rightEdge(2) - infoX, Math.min(3, g.p * 0.55));
    pb.text("instructions", instructionsFor(rightEdge(3) - infoX), infoX, 3, rightEdge(3) - infoX, Math.min(2.3, g.p * 0.42));
    infoRows = 4;
  } else {
    pb.text("title", title, g.xL, 0.5, qrX - C.blockGapMm - g.xL, titleFont, "bold");
    if (s.subtitle.trim()) pb.text("subtitle", s.subtitle, g.xL, 2, qrX - C.blockGapMm - g.xL, Math.min(3, g.p * 0.55));
    pb.text("instructions", instructionsFor(qrX - C.blockGapMm - g.xL), g.xL, 3, qrX - C.blockGapMm - g.xL, Math.min(2.3, g.p * 0.42));
    infoRows = 0;
  }

  let x = g.xL;
  let identityRows = 0;

  // ---- roll number grid
  if (s.rollDigits > 0) {
    const digits = s.rollDigits;
    const symbols = Array.from({ length: 10 }, (_, i) => String((i + s.rollStartDigit) % 10));
    pb.text("roll:label", "ROLL NUMBER", x, top, rollW, labelFont, "bold");
    const columns: Bubble[][] = [];
    const writeBoxes: BoxItem[] = [];
    for (let k = 0; k < digits; k++) {
      const cx = x + g.q / 2 + k * g.q;
      writeBoxes.push(pb.writeBox(`roll:box:d${k}`, cx, top + 1));
      columns.push(symbols.map((sym, si) => pb.bubble(`roll:d${k}:${sym}`, sym, cx, pb.rowCenter(top + 2 + si))));
    }
    pb.regions.push({
      kind: "roll", id: "p0:roll", digits, symbols,
      bbox: union([...columns.flat().map((b) => b.bbox), ...writeBoxes.map((b) => b.bbox)]),
      columns, writeBoxes,
    });
    x += rollW + C.blockGapMm;
    identityRows = Math.max(identityRows, 12);
  }

  // ---- exam set selector
  if (s.examSets >= 2) {
    const options = LETTERS.slice(0, s.examSets);
    pb.text("set:label", "SET", x, top, setW, labelFont, "bold");
    const bubbles = options.map((o, k) => pb.bubble(`set:${o}`, o, x + g.q / 2 + k * g.q, pb.rowCenter(top + 2)));
    pb.regions.push({ kind: "set", id: "p0:set", options, bbox: union(bubbles.map((b) => b.bbox)), bubbles });
    x += setW + C.blockGapMm;
    identityRows = Math.max(identityRows, 3);
  }

  // ---- name / class / signature lines (below the info text in compact mode)
  if (s.nameField) {
    const fields = ["Name", "Class", "Signature"];
    const labelW = 17;
    const first = top + infoRows + 1;
    fields.forEach((f, i) => {
      const row = first + i * 2;
      const lineX = x + labelW;
      const lineW = rightEdge(row) - lineX;
      if (lineW < 20) return;
      pb.text(`field:${f.toLowerCase()}`, `${f}:`, x, row, labelW - 1, labelFont);
      const baseline = pb.rowCenter(row) + g.p * 0.35;
      pb.boxes.push({ id: `p0:field:${f.toLowerCase()}:line`, kind: "field-line", bbox: rect(lineX, baseline, lineW, 0) });
    });
    identityRows = Math.max(identityRows, infoRows + 1 + fields.length * 2 - 1);
  }
  return { headerRows: Math.max(top + Math.max(identityRows, infoRows), qrRows) };
}

// ------------------------------------------------------------------ answer flow
interface FlowItem {
  kind: "heading" | "mcq" | "block";
  rows: number;
  width: number;
  sectionId: string;
  place(pb: PageBuilder, x0: number, row: number, ctx: FlowCtx): void;
}
interface FlowCtx { mcqRegion: (pb: PageBuilder, sectionId: string, col: number) => McqRegion }

function buildFlowItems(s: LayoutSettings, g: Geometry, numW: number, numFont: number): { items: FlowItem[]; questionCount: number } {
  const items: FlowItem[] = [];
  let qn = 0;
  const showHeadings = s.sections.length > 1 || s.sections.some((x) => x.name.trim() !== "");
  const headFont = Math.min(2.6, g.p * 0.47);

  for (const sec of s.sections) {
    const first = qn + 1;
    const last = qn + sec.questionCount;
    if (showHeadings) {
      const label = `${sec.name.trim() || "Section"}  (Q${first}${last > first ? `-${last}` : ""})`;
      items.push({
        kind: "heading", rows: 1, width: 0, sectionId: sec.id,
        place: (pb, x0, row) => { pb.text(`sec:${sec.id}:heading`, label, x0, row, colWidthOf(s, g), headFont, "bold"); },
      });
    }
    for (let i = 0; i < sec.questionCount; i++) {
      const n = ++qn;
      if (sec.type === "mcq") {
        const opts = optionLabels(sec);
        items.push({
          kind: "mcq", rows: 1, width: numW + opts.length * g.q, sectionId: sec.id,
          place: (pb, x0, row, ctx) => {
            const cy = pb.rowCenter(row);
            const num = pb.text(`q${n}:num`, `${n}`, x0, row, numW - 1.2, numFont, "bold", "right");
            const bubbles = opts.map((o, k) => pb.bubble(`q${n}:${o}`, o, x0 + numW + g.q / 2 + k * g.q, cy));
            const region = ctx.mcqRegion(pb, sec.id, -1);
            region.questions.push({ number: n, options: opts, bubbles, bbox: union([num.bbox, ...bubbles.map((b) => b.bbox)]) });
          },
        });
      } else if (sec.type === "numeric") {
        const signCols = sec.hasSign ? 1 : 0;
        const special = sec.hasSign || sec.hasDecimal ? 1 : 0;
        const rows = 2 + special + 10;
        items.push({
          kind: "block", rows, width: numW + (sec.digits + signCols) * g.q, sectionId: sec.id,
          place: (pb, x0, row) => {
            pb.text(`q${n}:num`, `${n}`, x0, row, numW - 1.2, numFont, "bold", "right");
            pb.text(`q${n}:hint`, "Numeric", x0 + numW, row, (sec.digits + signCols) * g.q, numFont * 0.85);
            const colX = (k: number) => x0 + numW + g.q / 2 + k * g.q;
            const writeBoxes = Array.from({ length: sec.digits + signCols }, (_, k) => pb.writeBox(`q${n}:box:${k}`, colX(k), row + 1));
            const signBubble = sec.hasSign ? pb.bubble(`q${n}:sign`, "-", colX(0), pb.rowCenter(row + 2)) : null;
            const decimalBubbles = sec.hasDecimal
              ? Array.from({ length: sec.digits }, (_, k) => pb.bubble(`q${n}:dot:d${k}`, ".", colX(k + signCols), pb.rowCenter(row + 2)))
              : [];
            const columns = Array.from({ length: sec.digits }, (_, k) =>
              Array.from({ length: 10 }, (_, v) => pb.bubble(`q${n}:d${k}:${v}`, String(v), colX(k + signCols), pb.rowCenter(row + 2 + special + v))));
            const all = [...columns.flat(), ...decimalBubbles, ...(signBubble ? [signBubble] : [])];
            pb.regions.push({
              kind: "numeric", id: `p${pb.index}:q${n}`, sectionId: sec.id, questionNumber: n,
              digits: sec.digits, hasSign: sec.hasSign, hasDecimal: sec.hasDecimal,
              bbox: union([...all.map((b) => b.bbox), ...writeBoxes.map((b) => b.bbox)]),
              signBubble, decimalBubbles, columns, writeBoxes,
            });
          },
        });
      } else {
        const rowLabels = LETTERS.slice(0, sec.rows);
        const colLabels = MATRIX_COLS.slice(0, sec.cols);
        items.push({
          kind: "block", rows: 1 + sec.rows, width: numW + 4 + sec.cols * g.q, sectionId: sec.id,
          place: (pb, x0, row) => {
            pb.text(`q${n}:num`, `${n}`, x0, row, numW - 1.2, numFont, "bold", "right");
            pb.text(`q${n}:hint`, "Matrix", x0 + numW, row, 4 + sec.cols * g.q, numFont * 0.85);
            const cells = rowLabels.map((rl, ri) => {
              const cy = pb.rowCenter(row + 1 + ri);
              pb.text(`q${n}:row:${rl}`, rl, x0 + numW, row + 1 + ri, 3, numFont, "bold");
              return colLabels.map((cl, ci) => pb.bubble(`q${n}:${rl}${cl}`, cl, x0 + numW + 4 + g.q / 2 + ci * g.q, cy));
            });
            pb.regions.push({
              kind: "matrix", id: `p${pb.index}:q${n}`, sectionId: sec.id, questionNumber: n,
              rows: rowLabels, cols: colLabels, bbox: union(cells.flat().map((b) => b.bbox)), cells,
            });
          },
        });
      }
    }
  }
  return { items, questionCount: qn };
}

function colWidthOf(s: LayoutSettings, g: Geometry) {
  return r3((g.xR - g.xL - (s.columns - 1) * C.gutterMm) / s.columns);
}

// ------------------------------------------------------------------ main entry
export function computeLayout(input: LayoutSettings): LayoutResult {
  const s = LayoutSettingsSchema.parse(input);
  const g = buildGeometry(s);
  const issues: LayoutIssue[] = [];

  const maxQ = s.sections.reduce((n, x) => n + x.questionCount, 0);
  const numFont = r3(Math.min(2.6, g.p * 0.48));
  const numW = r3(String(maxQ).length * numFont * 0.6 + 1.6);
  const colW = colWidthOf(s, g);
  const { items, questionCount } = buildFlowItems(s, g, numW, numFont);

  for (const it of items) {
    if (it.width > colW + EPS) {
      issues.push({ severity: "error", code: "COLUMN_TOO_NARROW",
        message: `Section "${s.sections.find((x) => x.id === it.sectionId)?.name || it.sectionId}" needs ${r3(it.width)} mm per column but only ${colW} mm is available. Reduce columns, options or bubble size.` });
      break;
    }
  }

  // QR size is fixed by payload length (hash length is constant).
  const dummy = qrModules(qrPayload(s.templateId, s.version, 0, 9, "0".repeat(16)));
  const qrSize = r3((dummy.length + 2 * C.qrQuietModules) * C.qrModuleMm);

  // Two passes: page count affects the continuation header text only, never geometry.
  const run = (pageCountGuess: number) => {
    const pages: PageBuilder[] = [];
    const answerStart: number[] = [];
    const newPage = () => {
      const pb = new PageBuilder(pages.length, g);
      const { headerRows } = layoutHeader(pb, s, qrSize, pageCountGuess);
      const start = Math.ceil((headerRows + 1) / C.bubbleRowsPerCell) * C.bubbleRowsPerCell;
      if (start >= g.totalRows) {
        issues.push({ severity: "error", code: "PAGE_TOO_SMALL", page: pb.index, message: "Header leaves no room for answers on this paper size." });
      }
      pages.push(pb);
      answerStart.push(start);
      return pb;
    };

    let pb = newPage();
    let col = 0;
    let row = answerStart[0];
    const mcqRegions = new Map<string, McqRegion>();
    const ctx: FlowCtx = {
      mcqRegion: (page, sectionId) => {
        const key = `${page.index}:${col}:${sectionId}`;
        let region = mcqRegions.get(key);
        if (!region) {
          region = { kind: "mcq", id: `p${page.index}:mcq:c${col}:${sectionId}`, sectionId, bbox: rect(0, 0, 0, 0), questions: [] };
          mcqRegions.set(key, region);
          page.regions.push(region);
        }
        return region;
      },
    };
    const advanceColumn = () => {
      col++;
      if (col >= s.columns) {
        col = 0;
        pb = newPage();
      }
      row = answerStart[pb.index];
    };
    const atTop = () => row === answerStart[pb.index];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (pages.length > 50) {
        issues.push({ severity: "error", code: "TOO_MANY_PAGES", message: "Layout exceeds 50 pages; aborting." });
        break;
      }
      const gapBefore = (it.kind === "heading" || it.kind === "block") && !atTop() ? 1 : 0;
      // keep a heading together with the first item that follows it
      const need = gapBefore + it.rows + (it.kind === "heading" && items[i + 1] ? items[i + 1].rows : 0);
      if (row + need > g.totalRows && !atTop()) advanceColumn();
      else row += gapBefore;
      if (atTop() && it.rows > g.totalRows - row) {
        issues.push({ severity: "error", code: "ITEM_TOO_TALL", page: pb.index, message: `An item needs ${it.rows} rows but a column only has ${g.totalRows - row}.` });
      }
      const x0 = g.xL + col * (colW + C.gutterMm);
      it.place(pb, x0, row, ctx);
      row += it.rows;
    }
    for (const r of mcqRegions.values()) r.bbox = union(r.questions.map((q) => q.bbox));
    return pages;
  };

  let pages = run(1);
  if (pages.length > 1) {
    issues.length = 0;
    pages = run(pages.length);
    // re-run checks that were cleared
    for (const it of items) if (it.width > colW + EPS) {
      issues.push({ severity: "error", code: "COLUMN_TOO_NARROW", message: `An item needs ${r3(it.width)} mm per column but only ${colW} mm is available.` });
      break;
    }
  }

  // ---- fiducials + reference grid (identical on every page)
  const fid = (id: string, x: number, y: number): Mark => ({ id, center: [r3(x), r3(y)], bbox: centredSquare(x, y, C.fiducialSizeMm) });
  const fiducials = {
    shape: "square" as const, sizeMm: C.fiducialSizeMm,
    tl: fid("fid:tl", 0, 0), tr: fid("fid:tr", g.sheetW, 0), br: fid("fid:br", g.sheetW, g.sheetH), bl: fid("fid:bl", 0, g.sheetH),
  };
  const lastRow = g.rowYs.length - 1;
  const lastCol = g.columnXs.length - 1;
  const marks = g.rowYs.map((y, ri) => g.columnXs.map((x, ci) => {
    const isFiducial = (ri === 0 || ri === lastRow) && (ci === 0 || ci === lastCol);
    return { id: `grid:r${ri}:c${ci}`, center: [r3(x), r3(y)] as [number, number], bbox: centredSquare(x, y, isFiducial ? C.fiducialSizeMm : C.markSizeMm), isFiducial };
  }));
  const referenceGrid = {
    markSizeMm: C.markSizeMm, bubbleRowsPerCell: C.bubbleRowsPerCell, rowPitchMm: g.p,
    rowYs: g.rowYs, columnXs: g.columnXs, marks, minDetectRatio: 0.8,
  };

  const qrBox = rect(g.xR - qrSize, 0, qrSize, qrSize);
  const draftPages: OMRPage[] = pages.map((pb) => ({
    index: pb.index, fiducials, referenceGrid,
    qr: { payload: "", errorCorrection: C.qrErrorCorrection, modules: dummy.length, moduleSizeMm: C.qrModuleMm, quietZoneModules: C.qrQuietModules, bbox: qrBox, matrix: "" },
    texts: pb.texts, boxes: pb.boxes, regions: pb.regions,
  }));

  const base = {
    schema: TEMPLATE_SCHEMA_ID, templateId: s.templateId, version: s.version, title: s.title, units: "mm" as const,
    paper: { size: s.paper, widthMm: g.paperW, heightMm: g.paperH, originMm: [r3(g.originX), r3(g.originY)] as [number, number], minPrintMarginMm: C.minPrintMarginMm },
    sheet: { widthMm: g.sheetW, heightMm: g.sheetH },
    bubble: { diameterMm: g.d, strokeMm: C.strokeMm, optionPitchMm: g.q, rowPitchMm: g.p, innerSampleRatio: C.innerSampleRatio },
    rollStartDigit: s.rollStartDigit, questionCount,
  };
  const layoutHash = sha256Hex(canonicalJson({ ...base, pages: draftPages })).slice(0, 16);

  const finalPages = draftPages.map((p) => {
    const payload = qrPayload(s.templateId, s.version, p.index, draftPages.length, layoutHash);
    const m = qrModules(payload);
    if (m.length !== dummy.length) issues.push({ severity: "error", code: "QR_SIZE_DRIFT", page: p.index, message: "QR version changed between sizing and rendering." });
    return { ...p, qr: { ...p.qr, payload, modules: m.length, matrix: m.map((r) => r.map((v) => (v ? "1" : "0")).join("")).join("/") } };
  });

  const template: OMRTemplate = { ...base, layoutHash, pages: finalPages };
  issues.push(...validateTemplate(template));
  const bubbles = finalPages.reduce((n, p) => n + collectBubbles(p).length, 0);
  return { template, issues, stats: { pages: finalPages.length, bubbles, questions: questionCount, marksPerPage: marks.flat().length } };
}

// ------------------------------------------------------------------ traversal helpers
export function collectBubbles(page: OMRPage): Bubble[] {
  const out: Bubble[] = [];
  for (const r of page.regions) {
    if (r.kind === "roll") out.push(...r.columns.flat());
    else if (r.kind === "set") out.push(...r.bubbles);
    else if (r.kind === "mcq") for (const q of r.questions) out.push(...q.bubbles);
    else if (r.kind === "numeric") out.push(...r.columns.flat(), ...r.decimalBubbles, ...(r.signBubble ? [r.signBubble] : []));
    else if (r.kind === "matrix") out.push(...r.cells.flat());
  }
  return out;
}

interface Ink { id: string; rect: Rect; pad: number }

function collectInk(page: OMRPage): Ink[] {
  const pad = C.minClearanceMm / 2;
  const ink: Ink[] = [];
  for (const f of [page.fiducials.tl, page.fiducials.tr, page.fiducials.br, page.fiducials.bl])
    ink.push({ id: `p${page.index}:${f.id}`, rect: f.bbox, pad: C.fiducialQuietZoneMm });
  for (const m of page.referenceGrid.marks.flat()) if (!m.isFiducial) ink.push({ id: `p${page.index}:${m.id}`, rect: m.bbox, pad });
  ink.push({ id: `p${page.index}:qr`, rect: page.qr.bbox, pad });
  for (const t of page.texts) ink.push({ id: t.id, rect: t.bbox, pad });
  for (const b of page.boxes) ink.push({ id: b.id, rect: b.kind === "field-line" ? { ...b.bbox, y: b.bbox.y - 0.15, h: 0.3 } : b.bbox, pad });
  for (const b of collectBubbles(page)) ink.push({ id: b.id, rect: b.bbox, pad });
  return ink;
}

/** Structural + geometric validation. Errors block export; warnings are advisory. */
export function validateTemplate(t: OMRTemplate): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const parsed = OMRTemplateSchema.safeParse(t);
  if (!parsed.success) {
    issues.push({ severity: "error", code: "SCHEMA", message: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return issues;
  }
  const [ox, oy] = t.paper.originMm;
  const minM = t.paper.minPrintMarginMm;

  for (const page of t.pages) {
    const ink = collectInk(page);

    // unique ids
    const seen = new Set<string>();
    for (const i of ink) {
      if (seen.has(i.id)) issues.push({ severity: "error", code: "DUPLICATE_ID", page: page.index, message: `Duplicate element id ${i.id}`, ids: [i.id] });
      seen.add(i.id);
    }

    // printable area
    for (const i of ink) {
      const x0 = i.rect.x + ox, y0 = i.rect.y + oy;
      if (x0 < minM - EPS || y0 < minM - EPS || x0 + i.rect.w > t.paper.widthMm - minM + EPS || y0 + i.rect.h > t.paper.heightMm - minM + EPS) {
        issues.push({ severity: "error", code: "OUT_OF_PRINTABLE_AREA", page: page.index, message: `${i.id} is outside the ${minM} mm printable margin`, ids: [i.id] });
      }
    }

    // pairwise clearance via spatial hashing (O(n))
    const cell = 8;
    const buckets = new Map<string, number[]>();
    ink.forEach((i, idx) => {
      const x0 = Math.floor((i.rect.x - i.pad) / cell), x1 = Math.floor((i.rect.x + i.rect.w + i.pad) / cell);
      const y0 = Math.floor((i.rect.y - i.pad) / cell), y1 = Math.floor((i.rect.y + i.rect.h + i.pad) / cell);
      for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
        const k = `${bx},${by}`;
        (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(idx);
      }
    });
    const reported = new Set<string>();
    for (const list of buckets.values()) {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const A = ink[list[a]], B = ink[list[b]];
        const key = A.id < B.id ? `${A.id}|${B.id}` : `${B.id}|${A.id}`;
        if (reported.has(key)) continue;
        const pad = Math.max(A.pad, B.pad) === C.fiducialQuietZoneMm ? C.fiducialQuietZoneMm : A.pad + B.pad;
        const overlap =
          A.rect.x < B.rect.x + B.rect.w + pad - EPS && B.rect.x < A.rect.x + A.rect.w + pad - EPS &&
          A.rect.y < B.rect.y + B.rect.h + pad - EPS && B.rect.y < A.rect.y + A.rect.h + pad - EPS;
        if (overlap) {
          reported.add(key);
          issues.push({ severity: "error", code: "OVERLAP", page: page.index, message: `${A.id} and ${B.id} are closer than ${r3(pad)} mm`, ids: [A.id, B.id] });
        }
      }
    }

    // reference grid integrity
    const g = page.referenceGrid;
    const pitch = g.bubbleRowsPerCell * g.rowPitchMm;
    for (let i = 1; i < g.rowYs.length; i++) {
      if (Math.abs(g.rowYs[i] - g.rowYs[i - 1] - pitch) > 0.002)
        issues.push({ severity: "error", code: "GRID_PITCH", page: page.index, message: `Reference grid row ${i} is not ${pitch} mm below row ${i - 1}` });
    }
    const corners = [[0, 0, page.fiducials.tl], [0, g.columnXs.length - 1, page.fiducials.tr], [g.rowYs.length - 1, g.columnXs.length - 1, page.fiducials.br], [g.rowYs.length - 1, 0, page.fiducials.bl]] as const;
    for (const [ri, ci, f] of corners) {
      const m = g.marks[ri][ci];
      if (!m.isFiducial || m.center[0] !== f.center[0] || m.center[1] !== f.center[1])
        issues.push({ severity: "error", code: "GRID_CORNER", page: page.index, message: `Grid corner ${m.id} does not coincide with fiducial ${f.id}` });
    }

    // every bubble lies inside the cell it names, and bubbles keep ≥ d + clearance spacing (covered by OVERLAP)
    for (const b of collectBubbles(page)) {
      const [ri, ci] = b.cell;
      const inside = ri < g.rowYs.length - 1 && ci < g.columnXs.length - 1 &&
        b.center[0] >= g.columnXs[ci] - EPS && b.center[0] <= g.columnXs[ci + 1] + EPS &&
        b.center[1] >= g.rowYs[ri] - EPS && b.center[1] <= g.rowYs[ri + 1] + EPS;
      if (!inside) issues.push({ severity: "error", code: "BUBBLE_CELL", page: page.index, message: `${b.id} is not inside reference cell [${b.cell}]`, ids: [b.id] });
    }

    // QR payload sanity
    if (!parseQrPayload(page.qr.payload)) issues.push({ severity: "error", code: "QR_PAYLOAD", page: page.index, message: "QR payload is malformed" });
    if (page.qr.moduleSizeMm < 0.4) issues.push({ severity: "warning", code: "QR_SMALL", page: page.index, message: "QR modules under 0.4 mm may not decode from phone photos" });
  }
  if (t.bubble.diameterMm < 3.5) issues.push({ severity: "warning", code: "SMALL_BUBBLES", message: "Bubbles under 3.5 mm are harder to fill and to read from low-resolution photos." });
  return issues;
}
