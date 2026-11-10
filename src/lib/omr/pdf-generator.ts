/**
 * 100% client-side vector PDF exporter (pdf-lib). Draws only what `pagePrimitives` emits,
 * i.e. only what the layout engine computed. The template JSON is embedded as a PDF
 * attachment so a printed sheet's source file always carries its own coordinate map.
 *
 * Output is deterministic: fixed metadata dates, no producer timestamps.
 */
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { pagePrimitives, type Prim } from "./primitives";
import type { OMRTemplate } from "./schema";

const PT_PER_MM = 72 / 25.4;
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawPrim(page: PDFPage, pr: Prim, fonts: { regular: PDFFont; bold: PDFFont }) {
  const H = page.getHeight();
  const pt = (v: number) => v * PT_PER_MM;
  switch (pr.t) {
    case "rect":
      page.drawRectangle({
        x: pt(pr.x), y: H - pt(pr.y + pr.h), width: pt(pr.w), height: pt(pr.h),
        color: pr.fill ? hex(pr.fill) : undefined,
        borderColor: pr.stroke ? hex(pr.stroke) : undefined,
        borderWidth: pr.stroke ? pt(pr.strokeW ?? 0.2) : 0,
      });
      break;
    case "circle":
      page.drawEllipse({ x: pt(pr.cx), y: H - pt(pr.cy), xScale: pt(pr.r), yScale: pt(pr.r), borderColor: hex(pr.stroke), borderWidth: pt(pr.strokeW) });
      break;
    case "line":
      page.drawLine({ start: { x: pt(pr.x1), y: H - pt(pr.y1) }, end: { x: pt(pr.x2), y: H - pt(pr.y2) }, thickness: pt(pr.strokeW), color: hex(pr.stroke) });
      break;
    case "text": {
      const font = pr.bold ? fonts.bold : fonts.regular;
      let size = pt(pr.size);
      let width = font.widthOfTextAtSize(pr.text, size);
      const maxW = pt(pr.maxW);
      if (width > maxW) { size *= maxW / width; width = maxW; }    // shrink-to-fit, never overflow the bbox
      const x = pr.anchor === "start" ? pt(pr.x) : pr.anchor === "end" ? pt(pr.x) - width : pt(pr.x) - width / 2;
      page.drawText(pr.text, { x, y: H - pt(pr.y), size, font, color: hex(pr.fill) });
      break;
    }
  }
}

export async function generatePdf(template: OMRTemplate, opts: { embedTemplate?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(template.title || "OMR answer sheet");
  doc.setSubject(`omr-template ${template.templateId} v${template.version} hash ${template.layoutHash}`);
  doc.setKeywords(["omr", template.schema, template.layoutHash]);
  doc.setCreator("OMR Sheet Designer");
  doc.setProducer("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  for (const p of template.pages) {
    const page = doc.addPage([template.paper.widthMm * PT_PER_MM, template.paper.heightMm * PT_PER_MM]);
    for (const pr of pagePrimitives(template, p)) drawPrim(page, pr, fonts);
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
