/**
 * Pipeline orchestrator: RGBA frame + template → ScanResult (or a typed VisionError).
 *
 *   normalize → detect corners → global warp → QR identity (+180° retry) → darkness map
 *   → reference-mark refinement → per-cell homographies → bubble densities → field decode
 *
 * Pure with respect to its inputs: OpenCV is injected, all WASM memory is freed before
 * returning, and the result is plain JSON.
 */
import type { OMRTemplate } from "@/lib/omr/schema";
import { type CV, MatScope } from "./cv";
import { assertGridMatch, buildCellTransforms, refineReferenceMarks } from "./curl-correction";
import { decodeFields } from "./decode-fields";
import { detectCorners, warpToCanonical } from "./detect-corners";
import { canonicalFrame, DEFAULT_PX_PER_MM, invertMat3 } from "./geometry";
import { DEFAULT_MAX_LONG_EDGE, inkDarkness, normalizeFrame } from "./normalize";
import { decodeQr, qrMatchesTemplate } from "./qr";
import { thresholdsFor } from "./tuning";
import { readBubbles } from "./read-bubbles";
import {
  type CornerPoints,
  type Mat3,
  type RgbaFrame,
  type ScanOptions,
  type ScanResult,
  type ScanTelemetry,
  VisionError,
} from "./types";

function mul3(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return r.map((v) => v / r[8]) as unknown as Mat3;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface ScanOutput extends ScanResult {
  /** normalized image px → canonical px */
  globalWarp: Mat3;
  /** normalized px = input px × frameScale */
  frameScale: number;
}

export function scanSheet(cv: CV, frame: RgbaFrame, template: OMRTemplate, opts: ScanOptions = {}): ScanOutput {
  const t0 = now();
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const scope = new MatScope();
  const cf = canonicalFrame(template, opts.pxPerMm ?? DEFAULT_PX_PER_MM);
  let last = t0;
  let cornersDetected = false;
  const emit = (status: ScanTelemetry["status"], stage: string, message?: string) =>
    opts.onTelemetry?.({ status, stage, frameTimeMs: Math.round(now() - t0), cornersDetected, message });
  const mark = (stage: string) => { const t = now(); timings[stage] = Math.round((t - last) * 10) / 10; last = t; };

  try {
    emit("processing", "normalize");
    const norm = normalizeFrame(cv, frame, opts.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE, true);
    scope.track(norm.gray);
    if (norm.full) scope.track(norm.full);
    mark("normalize");

    emit("searching", "detect-corners");
    const { corners } = detectCorners(cv, norm.gray, template);
    cornersDetected = true;
    mark("detectCorners");
    emit("aligned", "warp");

    const warp = warpToCanonical(cv, norm.gray, corners, cf, template);
    let canonical = scope.track(warp.canonical);
    mark("warp");

    // ---- identity: QR read from the full-resolution frame; mirrored position = upside down
    const inv = 1 / norm.scale;
    const canonToSource = mul3([inv, 0, 0, 0, inv, 0, 0, 0, 1], invertMat3(warp.matrix));
    const source = norm.full ?? norm.gray;
    let payload = decodeQr(cv, source, canonToSource, template, cf, false);
    let rotated180 = false;
    if (!payload) {
      const p2 = decodeQr(cv, source, canonToSource, template, cf, true);
      if (p2) {
        payload = p2;
        rotated180 = true;
        const flipped = scope.track(new cv.Mat());
        cv.rotate(canonical, flipped, cv.ROTATE_180);
        canonical = flipped;
      }
    }
    const { parsed, matches } = qrMatchesTemplate(payload, template);
    if (payload && !matches && opts.requireTemplateMatch !== false)
      throw new VisionError("TEMPLATE_MISMATCH", "this sheet was printed from a different template or version", { payload, expected: { templateId: template.templateId, version: template.version, layoutHash: template.layoutHash } });
    if (!payload) warnings.push("QR code not readable; using the requested page and orientation");
    const pageIndex = matches && parsed ? parsed.page : opts.pageIndex ?? 0;
    const page = template.pages[pageIndex];
    if (!page) throw new VisionError("TEMPLATE_MISMATCH", `template has no page ${pageIndex + 1}`);
    mark("qr");

    // ---- curl correction
    emit("processing", "curl-correction");
    opts.onCanonical?.({ width: canonical.cols, height: canonical.rows, gray: new Uint8Array(canonical.data) });
    const darkness = scope.track(inkDarkness(cv, canonical, template.bubble.diameterMm * cf.pxPerMm * 2.4));
    mark("darkness");
    const marks = refineReferenceMarks(cv, darkness, page, cf);
    const ratio = assertGridMatch(marks, page.referenceGrid.minDetectRatio);
    const cells = buildCellTransforms(page, marks, cf, opts.curlCorrection !== false);
    const worst = Math.max(...marks.map((m) => m.offsetMm));
    if (worst > 3) warnings.push(`paper curl up to ${worst.toFixed(1)} mm corrected`);
    mark("curl");

    // ---- read & decode
    emit("processing", "read-bubbles");
    const bubbles = readBubbles(darkness, page, template, cells, cf, thresholdsFor(opts.tuning));
    mark("bubbles");
    const fields = decodeFields(page, bubbles);
    mark("decode");

    // When the sheet was read upside down, fold the 180° turn into the reported geometry.
    let globalWarp = warp.matrix;
    let sheetCorners = corners;
    if (rotated180) {
      const W = cf.widthPx - 1, H = cf.heightPx - 1;
      const R: Mat3 = [-1, 0, W, 0, -1, H, 0, 0, 1];
      globalWarp = mul3(R, warp.matrix);
      sheetCorners = { ...corners, tl: corners.br, tr: corners.bl, br: corners.tl, bl: corners.tr };
    }

    const toInput = (c: CornerPoints): CornerPoints => ({
      ...c,
      tl: { x: c.tl.x * inv, y: c.tl.y * inv }, tr: { x: c.tr.x * inv, y: c.tr.y * inv },
      bl: { x: c.bl.x * inv, y: c.bl.y * inv }, br: { x: c.br.x * inv, y: c.br.y * inv },
    });
    timings.total = Math.round((now() - t0) * 10) / 10;
    const result: ScanOutput = {
      templateId: template.templateId,
      layoutHash: template.layoutHash,
      pageIndex,
      corners: toInput(sheetCorners),
      qr: { payload, matchesTemplate: matches, pageIndex: parsed?.page ?? null, rotated180 },
      referenceMarks: marks,
      markDetectRatio: ratio,
      cellTransforms: cells,
      bubbles,
      fields,
      canonical: { widthPx: cf.widthPx, heightPx: cf.heightPx, pxPerMm: cf.pxPerMm, padMm: cf.padMm },
      timingsMs: timings,
      warnings,
      globalWarp,
      frameScale: norm.scale,
    };
    emit("success", "done", fields.conflicts.length ? `${fields.conflicts.length} item(s) need review` : undefined);
    return result;
  } catch (e) {
    const err = e instanceof VisionError ? e : new VisionError("INTERNAL", e instanceof Error ? e.message : String(e));
    emit("error", "failed", err.message);
    throw err;
  } finally {
    scope.dispose();
  }
}

/** Fast path for live camera framing: corners only, on a smaller frame. Never throws. */
export function detectAlignment(cv: CV, frame: RgbaFrame, template: OMRTemplate, maxLongEdge = 640): { corners: CornerPoints | null; telemetry: ScanTelemetry } {
  const t0 = now();
  const scope = new MatScope();
  try {
    const norm = normalizeFrame(cv, frame, maxLongEdge);
    scope.track(norm.gray);
    const { corners } = detectCorners(cv, norm.gray, template);
    const inv = 1 / norm.scale;
    const s = (p: { x: number; y: number }) => ({ x: p.x * inv, y: p.y * inv });
    return {
      corners: { ...corners, tl: s(corners.tl), tr: s(corners.tr), bl: s(corners.bl), br: s(corners.br) },
      telemetry: { status: "aligned", stage: "detect-corners", frameTimeMs: Math.round(now() - t0), cornersDetected: true },
    };
  } catch (e) {
    return {
      corners: null,
      telemetry: { status: "searching", stage: "detect-corners", frameTimeMs: Math.round(now() - t0), cornersDetected: false, message: e instanceof Error ? e.message : String(e) },
    };
  } finally {
    scope.dispose();
  }
}
