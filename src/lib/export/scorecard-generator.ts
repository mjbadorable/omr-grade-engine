/**
 * Student scorecard slips (vector PDF, pdf-lib). One A4 page per student; batch output is a
 * single PDF with one page per student. Deterministic bytes for identical input.
 */
import { BRAND } from "@/lib/brand";
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { ScoredSheet } from "@/lib/grading/types";
import { sanitizeText } from "@/lib/omr/layout-engine";

export interface ImageCrop { bytes: Uint8Array; type: "jpeg" | "png" }

export interface ScorecardInput {
  institute: string;
  examTitle: string;
  date: string;
  student: { name: string | null; rollNumber: string | null; section?: string };
  sheet: ScoredSheet;
  rank: number | null;
  classSize: number;
  percentile: number | null;
  crops?: { roll?: ImageCrop; signature?: ImageCrop };
}

export { computeClassStanding, type Standing } from "./standing";

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.42, 0.43, 0.47);
const LINE = rgb(0.85, 0.86, 0.88);
const STATUS_COLOR: Record<string, ReturnType<typeof rgb>> = {
  CORRECT: rgb(0.05, 0.5, 0.25),
  PARTIAL: rgb(0.05, 0.4, 0.65),
  INCORRECT: rgb(0.75, 0.12, 0.12),
  OMITTED: rgb(0.55, 0.55, 0.58),
  FLAGGED_CONFLICT: rgb(0.75, 0.45, 0.02),
};
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

interface Fonts { r: PDFFont; b: PDFFont; m: PDFFont }

function text(page: PDFPage, s: string, x: number, yTop: number, size: number, font: PDFFont, opts: { color?: ReturnType<typeof rgb>; maxW?: number; align?: "left" | "right" | "center" } = {}) {
  let t = sanitizeText(s);
  let w = font.widthOfTextAtSize(t, size);
  if (opts.maxW && w > opts.maxW) {
    while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > opts.maxW) t = t.slice(0, -1);
    t += "…";
    w = font.widthOfTextAtSize(t, size);
  }
  const H = page.getHeight();
  const dx = opts.align === "right" ? -w : opts.align === "center" ? -w / 2 : 0;
  page.drawText(t, { x: x + dx, y: H - yTop - size * 0.8, size, font, color: opts.color ?? INK });
  return w;
}

function box(page: PDFPage, x: number, yTop: number, w: number, h: number, fill?: ReturnType<typeof rgb>) {
  page.drawRectangle({ x, y: page.getHeight() - yTop - h, width: w, height: h, color: fill, borderColor: LINE, borderWidth: 0.6 });
}

async function drawCard(doc: PDFDocument, f: Fonts, c: ScorecardInput) {
  const page = doc.addPage(A4);
  const W = A4[0] - 2 * M;
  const s = c.sheet;
  let y = M;

  // ---- header
  text(page, c.institute || "Assessment Report", M, y, 15, f.b, { maxW: W - 150 });
  text(page, c.date, M + W, y + 2, 9, f.r, { color: MUTED, align: "right" });
  y += 20;
  text(page, c.examTitle, M, y, 11, f.r, { color: MUTED, maxW: W });
  y += 20;
  page.drawLine({ start: { x: M, y: A4[1] - y }, end: { x: M + W, y: A4[1] - y }, thickness: 1, color: INK });
  y += 12;

  // ---- student block (+ verification crops on the right)
  const cropW = c.crops?.roll || c.crops?.signature ? 190 : 0;
  const fields: [string, string][] = [
    ["Student", c.student.name ?? "Not on roster"],
    ["Roll number", c.student.rollNumber ?? s.rollNumber ?? "unreadable"],
    ["Exam set", s.examSet ?? "-"],
    ["Section", c.student.section ?? "-"],
  ];
  fields.forEach(([k, v], i) => {
    text(page, k, M, y + i * 16, 8.5, f.r, { color: MUTED });
    text(page, v, M + 80, y + i * 16 - 1, 10.5, i === 0 ? f.b : f.r, { maxW: W - cropW - 90 });
  });
  let cropsBottom = y;
  if (cropW) {
    let cy = y - 4;
    for (const [label, crop, maxH] of [["Scanned roll number", c.crops?.roll, 80], ["Signature", c.crops?.signature, 34]] as const) {
      if (!crop) continue;
      const img = crop.type === "png" ? await doc.embedPng(crop.bytes) : await doc.embedJpg(crop.bytes);
      const k = Math.min((cropW - 10) / img.width, maxH / img.height);
      const w = img.width * k, h = img.height * k;
      text(page, label, M + W - cropW, cy, 7, f.r, { color: MUTED });
      page.drawImage(img, { x: M + W - w, y: A4[1] - cy - 9 - h, width: w, height: h });
      box(page, M + W - w, cy + 9, w, h);
      cy += h + 16;
    }
    cropsBottom = cy;
  }
  y = Math.max(y + 4 * 16, cropsBottom) + 8;

  // ---- metric tiles
  const tiles: [string, string][] = [
    ["Score", `${s.totalScore} / ${s.maxScore}`],
    ["Percentage", `${s.percentage.toFixed(1)} %`],
    ["Grade", s.grade ?? "-"],
    ["Class rank", c.rank ? `${c.rank} of ${c.classSize}` : "-"],
    ["Percentile", c.percentile === null ? "-" : `${c.percentile.toFixed(1)}`],
  ];
  const tw = (W - 4 * 8) / 5;
  tiles.forEach(([k, v], i) => {
    const x = M + i * (tw + 8);
    box(page, x, y, tw, 44, rgb(0.97, 0.97, 0.98));
    text(page, k, x + 8, y + 7, 8, f.r, { color: MUTED });
    text(page, v, x + 8, y + 21, 14, f.b, { maxW: tw - 14 });
  });
  y += 56;
  text(page, `Correct ${s.correctCount} · Incorrect ${s.incorrectCount} · Omitted ${s.omittedCount}${s.flaggedCount ? ` · Under review ${s.flaggedCount}` : ""} · Accuracy ${(s.accuracy * 100).toFixed(0)} %`, M, y, 9, f.r, { color: MUTED, maxW: W });
  y += 18;

  // ---- subject / section breakdown
  const domains = Object.keys(s.bySubject).length ? s.bySubject : s.bySection;
  const names = Object.keys(domains).sort();
  if (names.length) {
    text(page, Object.keys(s.bySubject).length ? "By subject" : "By section", M, y, 10, f.b);
    y += 15;
    for (const n of names) {
      const d = domains[n];
      const pct = d.max > 0 ? Math.max(0, d.score / d.max) : 0;
      text(page, n, M, y, 9, f.r, { maxW: 120 });
      box(page, M + 125, y + 1, 250, 8, rgb(0.95, 0.95, 0.96));
      page.drawRectangle({ x: M + 125, y: A4[1] - y - 9, width: 250 * Math.min(1, pct), height: 8, color: rgb(0.31, 0.27, 0.9) });
      text(page, `${d.score} / ${d.max}  (${d.correct}/${d.total} correct)`, M + 385, y, 9, f.r, { color: MUTED });
      y += 14;
    }
    y += 6;
  }

  // ---- response grid (auto-fits the remaining page)
  const items = s.items.filter((i) => !i.notes.includes("DROPPED"));
  text(page, "Responses", M, y, 10, f.b);
  y += 15;
  const bottom = A4[1] - M - 18;
  const avail = bottom - y;
  let rowH = 11;
  const colMinW = 104;
  const maxCols = Math.floor((W + 8) / (colMinW + 8));
  let rows = Math.max(1, Math.floor((avail - 12) / rowH));
  while (Math.ceil(items.length / rows) > maxCols && rowH > 6.5) { rowH -= 0.5; rows = Math.floor((avail - 12) / rowH); }
  const cols = Math.max(1, Math.ceil(items.length / rows));
  const cw = (W - (cols - 1) * 8) / cols;
  const fs = Math.min(8, rowH * 0.72);
  for (let c0 = 0; c0 < cols; c0++) {
    const x = M + c0 * (cw + 8);
    text(page, "Q", x, y, 7, f.b, { color: MUTED });
    text(page, "Yours", x + cw * 0.2, y, 7, f.b, { color: MUTED });
    text(page, "Key", x + cw * 0.48, y, 7, f.b, { color: MUTED });
    text(page, "Marks", x + cw, y, 7, f.b, { color: MUTED, align: "right" });
    items.slice(c0 * rows, (c0 + 1) * rows).forEach((it, r) => {
      const ry = y + 11 + r * rowH;
      if (r % 2 === 0) page.drawRectangle({ x, y: A4[1] - ry - rowH + 2, width: cw, height: rowH, color: rgb(0.975, 0.975, 0.98) });
      const color = STATUS_COLOR[it.status] ?? INK;
      text(page, String(it.questionNumber), x + 2, ry, fs, f.m);
      text(page, it.answerText ?? (it.selectedLabels.join("") || "-"), x + cw * 0.2, ry, fs, f.m, { color, maxW: cw * 0.27 });
      text(page, it.correctLabels.join(" ") || "-", x + cw * 0.48, ry, fs, f.m, { color: MUTED, maxW: cw * 0.3 });
      text(page, it.status === "FLAGGED_CONFLICT" ? "review" : String(it.scoreEarned), x + cw - 2, ry, fs, f.m, { color, align: "right" });
    });
  }

  // ---- footer
  text(page, `Answer key v${s.keyVersion} · sheet ${s.sheetId}${s.sheetFlags.length ? ` · flags: ${s.sheetFlags.join(", ")}` : ""}`, M, A4[1] - M - 8, 7, f.r, { color: MUTED, maxW: W });
}

export async function generateScorecardsPdf(cards: readonly ScorecardInput[], meta: { title?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(meta.title ?? "Scorecards");
  doc.setCreator(`${BRAND.name}, ${BRAND.institution}`);
  doc.setProducer("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const fonts: Fonts = {
    r: await doc.embedFont(StandardFonts.Helvetica),
    b: await doc.embedFont(StandardFonts.HelveticaBold),
    m: await doc.embedFont(StandardFonts.Courier),
  };
  for (const c of cards) await drawCard(doc, fonts, c);
  return doc.save({ useObjectStreams: true });
}
