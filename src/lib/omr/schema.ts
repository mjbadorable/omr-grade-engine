/**
 * OMR Template schema — the single source of truth shared by the layout engine,
 * the PDF/SVG renderers and (Sprint 2) the OpenCV scanner.
 *
 * Coordinate system ("sheet space"):
 *   - Units: millimetres.
 *   - Origin: centre of the TOP-LEFT fiducial. +x right, +y down.
 *   - Points are [x, y] tuples. Rects are { x, y, w, h } with (x, y) = top-left corner.
 *   - Page (paper) coordinates = sheet coordinates + `page.originMm`.
 * Because everything is fiducial-relative, printer margins and scaling are absorbed by the
 * scanner's homography and never leak into the template.
 */
import { z } from "zod";

export const TEMPLATE_SCHEMA_ID = "omr-template/v1" as const;

// ---------------------------------------------------------------- primitives
const mm = z.number().finite();
export const PointSchema = z.tuple([mm, mm]);
export const RectSchema = z.object({ x: mm, y: mm, w: mm.nonnegative(), h: mm.nonnegative() });
export type Point = z.infer<typeof PointSchema>;
export type Rect = z.infer<typeof RectSchema>;

/** Index of the reference-grid cell that contains a point: [row, col]. */
export const CellRefSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
export type CellRef = z.infer<typeof CellRefSchema>;

// Bounds: generous (the biggest sheet the designer can produce is ~5-10x below them) but finite, so
// oversized or hostile payloads are refused before they are processed or stored.
const id = z.string().max(120);

export const BubbleSchema = z.object({
  id,                             // stable, human-readable: "p0:q12:B", "p0:roll:d3:7"
  label: z.string().max(20),              // printed inside the bubble
  center: PointSchema,
  bbox: RectSchema,
  cell: CellRefSchema,            // piecewise-homography cell for curl correction
});
export type Bubble = z.infer<typeof BubbleSchema>;

export const TextSchema = z.object({
  id,
  text: z.string().max(500),
  fontSizeMm: z.number().positive(),
  weight: z.enum(["normal", "bold"]),
  align: z.enum(["left", "center", "right"]),
  bbox: RectSchema,               // text must fit inside; baseline at bbox bottom - descent
});
export type TextItem = z.infer<typeof TextSchema>;

export const BoxSchema = z.object({
  id,
  kind: z.enum(["write-box", "field-line", "frame"]),
  bbox: RectSchema,
});
export type BoxItem = z.infer<typeof BoxSchema>;

export const MarkSchema = z.object({ id, center: PointSchema, bbox: RectSchema });
export type Mark = z.infer<typeof MarkSchema>;

// ---------------------------------------------------------------- regions
export const RollRegionSchema = z.object({
  kind: z.literal("roll"),
  id,
  digits: z.number().int().min(1).max(12),
  symbols: z.array(z.string()).length(10),     // "0".."9" in printed order (rollStartDigit applied)
  bbox: RectSchema,
  /** columns[digitIndex][symbolIndex] — most significant digit first. */
  columns: z.array(z.array(BubbleSchema).max(10)).max(12),
  writeBoxes: z.array(BoxSchema).max(20),
});

export const SetRegionSchema = z.object({
  kind: z.literal("set"),
  id,
  options: z.array(z.string().max(20)).min(2).max(8),
  bbox: RectSchema,
  bubbles: z.array(BubbleSchema).max(8),
});

export const McqQuestionSchema = z.object({
  number: z.number().int().positive(),
  options: z.array(z.string().max(20)).min(2).max(10),
  bubbles: z.array(BubbleSchema).max(10),
  bbox: RectSchema,
});

export const McqRegionSchema = z.object({
  kind: z.literal("mcq"),
  id,
  sectionId: id,
  bbox: RectSchema,
  questions: z.array(McqQuestionSchema).max(400),
});

export const NumericRegionSchema = z.object({
  kind: z.literal("numeric"),
  id,
  sectionId: id,
  questionNumber: z.number().int().positive(),
  digits: z.number().int().min(1).max(10),
  hasSign: z.boolean(),
  hasDecimal: z.boolean(),
  bbox: RectSchema,
  /** Optional leading "−" bubble (exactly one). */
  signBubble: BubbleSchema.nullable(),
  /** Optional decimal-point row: one "." bubble per digit column (at most one may be marked). */
  decimalBubbles: z.array(BubbleSchema).max(12),
  /** columns[digitIndex][0..9] */
  columns: z.array(z.array(BubbleSchema).max(10)).max(12),
  writeBoxes: z.array(BoxSchema).max(20),
});

export const MatrixRegionSchema = z.object({
  kind: z.literal("matrix"),
  id,
  sectionId: id,
  questionNumber: z.number().int().positive(),
  rows: z.array(z.string().max(40)).min(1).max(10),
  cols: z.array(z.string().max(40)).min(1).max(10),
  bbox: RectSchema,
  /** cells[rowIndex][colIndex] */
  cells: z.array(z.array(BubbleSchema).max(10)).max(10),
});

export const RegionSchema = z.discriminatedUnion("kind", [
  RollRegionSchema,
  SetRegionSchema,
  McqRegionSchema,
  NumericRegionSchema,
  MatrixRegionSchema,
]);
export type Region = z.infer<typeof RegionSchema>;
export type RollRegion = z.infer<typeof RollRegionSchema>;
export type SetRegion = z.infer<typeof SetRegionSchema>;
export type McqRegion = z.infer<typeof McqRegionSchema>;
export type NumericRegion = z.infer<typeof NumericRegionSchema>;
export type MatrixRegion = z.infer<typeof MatrixRegionSchema>;

// ---------------------------------------------------------------- page-level geometry
export const FiducialsSchema = z.object({
  shape: z.literal("square"),
  sizeMm: z.number().positive(),
  tl: MarkSchema,
  tr: MarkSchema,
  br: MarkSchema,
  bl: MarkSchema,
});

/**
 * Anti-curl reference grid. Marks sit at every (rowY, columnX) intersection; the four
 * corner intersections ARE the fiducials. Rows are `bubbleRowsPerCell` answer rows apart.
 * Scanner: one homography per cell (4 surrounding marks); every bubble names its cell.
 */
export const ReferenceGridSchema = z.object({
  markSizeMm: z.number().positive(),
  bubbleRowsPerCell: z.number().int().positive(),
  rowPitchMm: z.number().positive(),
  rowYs: z.array(mm).min(2).max(500),
  columnXs: z.array(mm).min(2).max(100),
  /** marks[row][col]; corner entries reference the fiducials (same centre). */
  marks: z.array(z.array(MarkSchema.extend({ isFiducial: z.boolean() })).max(100)).max(500),
  minDetectRatio: z.number().min(0).max(1),
});

export const QrSchema = z.object({
  payload: z.string().max(2_000),
  errorCorrection: z.enum(["L", "M", "Q", "H"]),
  modules: z.number().int().positive(),   // modules per side (without quiet zone)
  moduleSizeMm: z.number().positive(),
  quietZoneModules: z.number().int().nonnegative(),
  /** Symbol area incl. quiet zone. */
  bbox: RectSchema,
  /** Row-major dark-module bitmap, '1' = dark, rows joined by '/'. Lets the renderers stay dependency-free. */
  matrix: z.string().max(100_000),
});

export const PageSchema = z.object({
  index: z.number().int().nonnegative(),
  fiducials: FiducialsSchema,
  referenceGrid: ReferenceGridSchema,
  qr: QrSchema,
  texts: z.array(TextSchema).max(500),
  boxes: z.array(BoxSchema).max(500),
  regions: z.array(RegionSchema).max(200),
});
export type OMRPage = z.infer<typeof PageSchema>;

export const PAPER_SIZES = {
  A4: { widthMm: 210, heightMm: 297 },
  LETTER: { widthMm: 215.9, heightMm: 279.4 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;

export const OMRTemplateSchema = z.object({
  schema: z.literal(TEMPLATE_SCHEMA_ID),
  templateId: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "letters, digits, - and _ only"),
  version: z.number().int().positive(),
  /** 16 hex chars: first 64 bits of SHA-256 over canonical geometry (QR payload excluded). */
  layoutHash: z.string().regex(/^[0-9a-f]{16}$/),
  title: z.string().max(200),
  units: z.literal("mm"),
  paper: z.object({
    size: z.enum(["A4", "LETTER"]),
    widthMm: z.number().positive(),
    heightMm: z.number().positive(),
    /** Page coordinate of the TL fiducial centre (= sheet origin). */
    originMm: PointSchema,
    minPrintMarginMm: z.number().nonnegative(),
  }),
  /** Fiducial centre-to-centre extents (TL→TR, TL→BL). */
  sheet: z.object({ widthMm: z.number().positive(), heightMm: z.number().positive() }),
  bubble: z.object({
    diameterMm: z.number().positive(),
    strokeMm: z.number().positive(),
    optionPitchMm: z.number().positive(),
    rowPitchMm: z.number().positive(),
    /** Scanner samples darkness inside a disc of radius = innerSampleRatio * r. */
    innerSampleRatio: z.number().gt(0).lte(1),
  }),
  rollStartDigit: z.union([z.literal(0), z.literal(1)]),
  questionCount: z.number().int().nonnegative().max(2_000),
  pages: z.array(PageSchema).min(1).max(60),
});
export type OMRTemplate = z.infer<typeof OMRTemplateSchema>;

// ---------------------------------------------------------------- designer settings (layout input)
export const McqSectionSettingsSchema = z.object({
  id: z.string(),
  name: z.string().max(40),
  type: z.literal("mcq"),
  questionCount: z.number().int().min(1).max(200),
  optionCount: z.number().int().min(2).max(6),
  optionStyle: z.enum(["letters", "numbers", "true-false"]),
});
export const NumericSectionSettingsSchema = z.object({
  id: z.string(),
  name: z.string().max(40),
  type: z.literal("numeric"),
  questionCount: z.number().int().min(1).max(20),
  digits: z.number().int().min(1).max(8),
  hasSign: z.boolean(),
  hasDecimal: z.boolean(),
});
export const MatrixSectionSettingsSchema = z.object({
  id: z.string(),
  name: z.string().max(40),
  type: z.literal("matrix"),
  questionCount: z.number().int().min(1).max(20),
  rows: z.number().int().min(2).max(6),
  cols: z.number().int().min(2).max(6),
});
export const SectionSettingsSchema = z.discriminatedUnion("type", [
  McqSectionSettingsSchema,
  NumericSectionSettingsSchema,
  MatrixSectionSettingsSchema,
]);
export type SectionSettings = z.infer<typeof SectionSettingsSchema>;

export const LayoutSettingsSchema = z.object({
  templateId: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "letters, digits, - and _ only"),
  version: z.number().int().positive(),
  title: z.string().max(80),
  subtitle: z.string().max(80),
  paper: z.enum(["A4", "LETTER"]),
  columns: z.number().int().min(1).max(6),
  bubbleDiameterMm: z.number().min(3.2).max(6),
  rollDigits: z.number().int().min(0).max(10),     // 0 = no roll grid
  rollStartDigit: z.union([z.literal(0), z.literal(1)]),
  examSets: z.number().int().min(0).max(6),        // 0/1 = no set selector
  nameField: z.boolean(),
  sections: z.array(SectionSettingsSchema).min(1),
});
export type LayoutSettings = z.infer<typeof LayoutSettingsSchema>;
