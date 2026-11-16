/**
 * 100% client-side vector PDF exporter (pdf-lib). Draws only what `pagePrimitives` emits,
 * i.e. only what the layout engine computed. The template JSON is embedded as a PDF
 * attachment so a printed sheet's source file always carries its own coordinate map.
 *
 * Output is deterministic: fixed metadata dates, no producer timestamps.
 */
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { BRAND } from "@/lib/brand";
import { applyDarkness, type Darkness, nUpLayout, type PerPage, sheetCrop } from "./print-options";
import { pagePrimitives, type Prim } from "./primitives";
import type { OMRTemplate } from "./schema";

const PT_PER_MM = 72 / 25.4;
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Prims are in paper mm; `T` places them on the output page (identity for 1-up). */
interface Place { dx: number; dy: number; s: number }
const IDENTITY: Place = { dx: 0, dy: 0, s: 1 };

function drawPrim(page: PDFPage, pr: Prim, fonts: { regular: PDFFont; bold: PDFFont }, T: Place = IDENTITY) {
  const H = page.getHeight();
  const px = (v: number) => (T.dx + v * T.s) * PT_PER_MM;       // x / absolute position
  const py = (v: number) => H - (T.dy + v * T.s) * PT_PER_MM;   // y (flipped)
  const len = (v: number) => v * T.s * PT_PER_MM;                // lengths, sizes, stroke widths
  switch (pr.t) {
    case "rect":
      page.drawRectangle({
        x: px(pr.x), y: py(pr.y + pr.h), width: len(pr.w), height: len(pr.h),
        color: pr.fill ? hex(pr.fill) : undefined,
        borderColor: pr.stroke ? hex(pr.stroke) : undefined,
        borderWidth: pr.stroke ? len(pr.strokeW ?? 0.2) : 0,
      });
      break;
    case "circle":
      page.drawEllipse({ x: px(pr.cx), y: py(pr.cy), xScale: len(pr.r), yScale: len(pr.r), borderColor: hex(pr.stroke), borderWidth: len(pr.strokeW) });
      break;
    case "line":
      page.drawLine({ start: { x: px(pr.x1), y: py(pr.y1) }, end: { x: px(pr.x2), y: py(pr.y2) }, thickness: len(pr.strokeW), color: hex(pr.stroke) });
      break;
    case "text": {
      const font = pr.bold ? fonts.bold : fonts.regular;
      let size = len(pr.size);
      let width = font.widthOfTextAtSize(pr.text, size);
      const maxW = len(pr.maxW);
      if (width > maxW) { size *= maxW / width; width = maxW; }    // shrink-to-fit, never overflow the bbox
      const x = pr.anchor === "start" ? px(pr.x) : pr.anchor === "end" ? px(pr.x) - width : px(pr.x) - width / 2;
      page.drawText(pr.text, { x, y: py(pr.y), size, font, color: hex(pr.fill) });
      break;
    }
  }
}

export interface PdfOptions {
  embedTemplate?: boolean;
  /** sheets per printed page: 1 (default), 2 (landscape) or 4 (2x2); copies of the same sheet page */
  perPage?: PerPage;
  /** "high" = darker outlines for photocopying */
  darkness?: Darkness;
}

export async function generatePdf(template: OMRTemplate, opts: PdfOptions = {}): Promise<Uint8Array> {
  const perPage = opts.perPage ?? 1;
  const darkness = opts.darkness ?? "standard";
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(template.title || "OMR answer sheet");
  doc.setSubject(`omr-template ${template.templateId} v${template.version} hash ${template.layoutHash}`);
  doc.setKeywords(["omr", template.schema, template.layoutHash]);
  doc.setCreator(`${BRAND.name}, ${BRAND.institution}`);
  doc.setProducer("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const crop = sheetCrop(template);
  const layout = nUpLayout(template.paper, perPage === 1 ? { x: 0, y: 0, w: template.paper.widthMm, h: template.paper.heightMm } : crop, perPage);
  for (const p of template.pages) {
    const page = doc.addPage([layout.pageWidthMm * PT_PER_MM, layout.pageHeightMm * PT_PER_MM]);
    const prims = applyDarkness(pagePrimitives(template, p), darkness);
    if (perPage === 1) {
      for (const pr of prims) drawPrim(page, pr, fonts);
      // Brand footer in the bottom paper margin, only when there is room outside the registered sheet area.
      const bottomMm = template.paper.heightMm - template.paper.originMm[1] - template.sheet.heightMm;
      if (bottomMm >= 9) {
        const text = `${BRAND.name} · ${BRAND.institution} · ${template.title || template.templateId} · v${template.version} · #${template.layoutHash}`.replace(/[^ -~·]/g, "?");   // standard fonts are WinAnsi only
        const size = 6;
        const w = fonts.regular.widthOfTextAtSize(text, size);
        page.drawText(text, { x: (template.paper.widthMm * PT_PER_MM - w) / 2, y: 4.5 * PT_PER_MM, size, font: fonts.regular, color: rgb(0.45, 0.45, 0.5) });
      }
      continue;
    }
    // multi-up: identical copies, uniformly scaled so the corner marks and QR keep exact proportions
    for (const c of layout.cells) {
      const T: Place = { dx: c.x - crop.x * c.scale, dy: c.y - crop.y * c.scale, s: c.scale };
      for (const pr of prims) drawPrim(page, pr, fonts, T);
    }
    for (const k of layout.cuts) {
      page.drawLine({ start: { x: k.x1 * PT_PER_MM, y: page.getHeight() - k.y1 * PT_PER_MM }, end: { x: k.x2 * PT_PER_MM, y: page.getHeight() - k.y2 * PT_PER_MM }, thickness: 0.3, color: rgb(0.7, 0.7, 0.72), dashArray: [3, 3] });   // cut guide, between the sheets
    }
  }
  if (opts.embedTemplate !== false) {
    await doc.attach(new TextEncoder().encode(JSON.stringify(template)), "template-coordinates.json", {
      mimeType: "application/json",
      description: `OMR template ${template.templateId} v${template.version}`,
      creationDate: FIXED_DATE,
      modificationDate: FIXED_DATE,
    });
  }
  return doc.save({ useObjectStreams: true });
}
