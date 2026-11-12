/**
 * Vision contracts for the edge OMR scanner (Sprint 2).
 *
 * Coordinate spaces:
 *   - template mm   : Sprint 1 sheet space (origin = TL fiducial centre, mm, y down)
 *   - image px      : the normalized (resized, grayscale) input frame
 *   - canonical px  : the globally de-warped sheet: canonical = (mm + CANONICAL_PAD_MM) * pxPerMm
 *
 * All exported data shapes are plain JSON (structured-clone safe) so they cross the
 * worker boundary unchanged. Nothing here depends on OpenCV.
 */
import type { OMRTemplate } from "@/lib/omr/schema";

export type Vec2 = { x: number; y: number };

/** Row-major 3×3 homography, h[8] normalised to 1. Maps (x, y, 1) → (x', y', w). */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

// ------------------------------------------------------------------ inputs
/** Frame payloads accepted by the pipeline / worker. */
export type ScanFrameInput =
  | { kind: "imageBitmap"; bitmap: ImageBitmap }
  | { kind: "imageData"; data: ImageData }
  | { kind: "offscreenCanvas"; canvas: OffscreenCanvas }
  | { kind: "blob"; blob: Blob };

/** Raw RGBA pixels: the only input format the pure pipeline itself consumes. */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray; // length = width * height * 4
}

// ------------------------------------------------------------------ geometry
/** Exactly four fiducial centres in image px, validated (convex, plausible aspect). */
export interface CornerPoints {
  tl: Vec2;
  tr: Vec2;
  bl: Vec2;
  br: Vec2;
  /** Measured width/height ratio of the quad (mean of opposite sides). */
  aspectRatio: number;
  /** Ratio of measured to template aspect (1 = perfect). */
  aspectError: number;
}

/** Piecewise perspective transform for one reference-grid cell (one 5-row band × column span). */
export interface CellTransform {
  row: number;
  col: number;
  /** template mm → canonical px */
  matrix: Mat3;
  /** Reference-mark centres used: template mm (TL, TR, BR, BL). */
  srcQuad: readonly [Vec2, Vec2, Vec2, Vec2];
  /** Same marks as detected in canonical px. */
  dstQuad: readonly [Vec2, Vec2, Vec2, Vec2];
}

export interface ReferenceMarkReadout {
  id: string;
  row: number;
  col: number;
  expected: Vec2;     // canonical px (from template)
  detected: Vec2;     // canonical px (refined, or = expected when not found)
  found: boolean;
  /** detected − expected, in mm */
  offsetMm: number;
}

// ------------------------------------------------------------------ readouts
export type BubbleState = "FILLED" | "EMPTY" | "PARTIAL" | "ERASURE";
export type BubbleField = "answer" | "roll" | "set" | "numeric" | "matrix";

export interface BubbleReadout {
  /** answer: question number − 1; roll: digit column; set: 0; numeric/matrix: question number − 1 */
  questionIndex: number;
  /** option within the group (answer option, roll symbol row, set option, numeric digit row, matrix cell) */
  optionIndex: number;
  /** Mean ink darkness inside the inner sampling disc, 0..1 (background-normalised). */
  density: number;
  state: BubbleState;
  /** 0..1 — distance from the nearest decision boundary. */
  confidence: number;
  // ---- extensions beyond the minimal contract (needed to address every bubble kind)
  bubbleId: string;
  field: BubbleField;
  /** Fraction of disc pixels darker than the ink threshold, 0..1. */
  coverage: number;
  /** Density after subtracting the group's empty baseline, 0..1. */
  adjustedDensity: number;
  /** Bubble centre in canonical px (for overlays). */
  center: Vec2;
}

// ------------------------------------------------------------------ decoded fields
export type ConflictCode =
  | "ROLL_DIGIT_BLANK"
  | "ROLL_DIGIT_MULTIPLE"
  | "ROLL_DIGIT_UNCERTAIN"
  | "SET_BLANK"
  | "SET_MULTIPLE"
  | "SET_UNCERTAIN"
  | "ANSWER_MULTIPLE"
  | "ANSWER_UNCERTAIN"
  | "NUMERIC_INVALID";

export interface FieldConflict {
  code: ConflictCode;
  field: BubbleField;
  /** roll digit column / question number / set → 0 */
  index: number;
  bubbleIds: string[];
  message: string;
}

export interface AnswerDecode {
  questionNumber: number;
  /** Option indices whose state is FILLED. */
  marked: number[];
  /** Option labels for `marked` (from the template). */
  labels: string[];
  /** true when PARTIAL/ERASURE bubbles make the answer uncertain. */
  uncertain: boolean;
}

export interface NumericDecode { questionNumber: number; value: string | null; uncertain: boolean }
export interface MatrixDecode { questionNumber: number; rows: Record<string, string[]>; uncertain: boolean }

export interface DecodedFields {
  rollNumber: string | null;      // null when any digit is in conflict
  rollDigits: (string | null)[];
  examSet: string | null;
  answers: AnswerDecode[];
  numeric: NumericDecode[];
  matrix: MatrixDecode[];
  conflicts: FieldConflict[];
}

// ------------------------------------------------------------------ telemetry & errors
export type ScanStatus = "searching" | "aligned" | "processing" | "success" | "error";

export interface ScanTelemetry {
  status: ScanStatus;
  stage: string;
  frameTimeMs: number;
  cornersDetected: boolean;
  message?: string;
}

export type VisionErrorCode =
  | "OPENCV_NOT_READY"
  | "INVALID_INPUT"
  | "CORNERS_NOT_FOUND"
  | "CORNERS_INVALID"
  | "GRID_MISMATCH"
  | "TEMPLATE_MISMATCH"
  | "INTERNAL";

export class VisionError extends Error {
  constructor(readonly code: VisionErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "VisionError";
  }
  toJSON(): VisionErrorPayload {
    return { code: this.code, message: this.message, details: this.details };
  }
}
export interface VisionErrorPayload { code: VisionErrorCode; message: string; details?: Record<string, unknown> }

// ------------------------------------------------------------------ pipeline result
export interface QrCheck {
  payload: string | null;
  /** payload decoded and templateId/version/hash match the supplied template */
  matchesTemplate: boolean;
  pageIndex: number | null;
  /** sheet was upside down and was rotated 180° before reading */
  rotated180: boolean;
}

export interface ScanResult {
  templateId: string;
  layoutHash: string;
  pageIndex: number;
  corners: CornerPoints;
  qr: QrCheck;
  referenceMarks: ReferenceMarkReadout[];
  markDetectRatio: number;
  cellTransforms: CellTransform[];
  bubbles: BubbleReadout[];
  fields: DecodedFields;
  canonical: { widthPx: number; heightPx: number; pxPerMm: number; padMm: number };
  timingsMs: Record<string, number>;
  warnings: string[];
}

export interface ScanOptions {
  /** canonical resolution (default 5 px/mm) */
  pxPerMm?: number;
  /** long-edge processing size (default 1280) */
  maxLongEdge?: number;
  /** page to read when the QR cannot be decoded (default 0) */
  pageIndex?: number;
  /** when false, skip piecewise homography (global warp only) — for diagnostics/tests */
  curlCorrection?: boolean;
  /** reject sheets whose QR identifies a different template (default true) */
  requireTemplateMatch?: boolean;
  /** field-calibration overrides of the fill decision (see tuning.ts); defaults are the tuned baseline */
  tuning?: { inkLevel?: number; fillCoverage?: number };
  onTelemetry?: (t: ScanTelemetry) => void;
  /** receives a copy of the de-warped 8-bit sheet (for review overlays) */
  onCanonical?: (img: { width: number; height: number; gray: Uint8Array }) => void;
}

export type { OMRTemplate };
