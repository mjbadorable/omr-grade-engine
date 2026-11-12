/**
 * 1-click accreditation report: a one-page PDF pairing the exam's psychometric reliability
 * (mean, SD, KR-20, SEM, item quality) with syllabus outcome attainment (CO bars, PO roll-up).
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { BRAND } from "@/lib/brand";
import type { PsychometricReport } from "@/lib/grading/types";
import type { AttainmentReport } from "./attainment";
import { PERIOD_LABEL, type ExamPeriod, type Syllabus } from "./types";

export interface AccreditationInput {
  institute: string;
  examName: string;
  period: ExamPeriod | null;
  syllabus: Pick<Syllabus, "courseCode" | "courseTitle" | "term"> | null;
  psychometrics: PsychometricReport;
  attainment: AttainmentReport;
  generatedAt: Date;
}

/** Plain-language reading of KR-20 for the audit slip. */
export function reliabilityLabel(kr20: number | null): string {
  if (kr20 === null) return "not computable";
  if (kr20 >= 0.9) return "excellent";
  if (kr20 >= 0.8) return "good";
  if (kr20 >= 0.7) return "acceptable";
  if (kr20 >= 0.6) return "marginal";
  return "poor";
}

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.4, 0.4, 0.45);
const LINE = rgb(0.85, 0.85, 0.88);
const OK = rgb(0.09, 0.55, 0.36);
const BAD = rgb(0.86, 0.15, 0.15);
const CRIMSON = rgb(0.557, 0.106, 0.125);

// pdf-lib standard fonts are WinAnsi only: replace anything else so the export never throws.
const safe = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, (c) => ({ "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "•": "*", "≥": ">=", "≤": "<=" } as Record<string, string>)[c] ?? "?");

function fit(font: PDFFont, s: string, size: number, maxW: number): string {
  let t = safe(s);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxW) t = t.slice(0, -1);
  return `${t}...`;
}

export async function buildAccreditationReport(i: AccreditationInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Accreditation report - ${i.examName}`);
  doc.setProducer(`${BRAND.name}, ${BRAND.institution}`);
  const f = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  let page: PDFPage = doc.addPage(A4);
  let y = M;
  const W = A4[0] - 2 * M;
  const T = (s: string, x: number, size: number, font: PDFFont, color = INK, maxW?: number) =>
    page.drawText(maxW ? fit(font, s, size, maxW) : safe(s), { x, y: A4[1] - y - size, size, font, color });
  const rule = () => page.drawLine({ start: { x: M, y: A4[1] - y }, end: { x: A4[0] - M, y: A4[1] - y }, thickness: 0.6, color: LINE });
  const ensure = (h: number) => { if (y + h > A4[1] - M - 30) { page = doc.addPage(A4); y = M; } };

  // brand header: wordmark + expansion, crimson rule, then the institute line
  page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: CRIMSON });
  T(BRAND.name, M, 13, f.b, CRIMSON); T(`${BRAND.expansion}`, M + 70, 7.5, f.r, MUTED, W - 70); y += 20;
  T(i.institute || BRAND.institution, M, 9, f.b, MUTED, W); y += 16;
  T("Outcomes-Based Assessment: Accreditation Audit Slip", M, 16, f.b, INK, W); y += 24;
  const course = i.syllabus ? `${i.syllabus.courseCode}  ${i.syllabus.courseTitle}` : "Course not linked to a syllabus";
  T(course, M, 11, f.b, CRIMSON, W); y += 16;
  T(`${i.examName}${i.period ? `  |  ${PERIOD_LABEL[i.period]}` : ""}${i.syllabus?.term ? `  |  ${i.syllabus.term}` : ""}`, M, 9, f.r, MUTED, W); y += 14;
  rule(); y += 12;

  // --- reliability
  const p = i.psychometrics;
  T("1. Assessment reliability (psychometrics)", M, 11, f.b); y += 18;
  const stats: [string, string][] = [
    ["Examinees (N)", String(p.n)], ["Items (k)", String(p.k)], ["Mean score", p.mean.toFixed(2)], ["Std. deviation", p.sd.toFixed(2)],
    ["KR-20", p.kr20 === null ? "n/a" : `${p.kr20.toFixed(2)} (${reliabilityLabel(p.kr20)})`], ["SEM", p.sem === null ? "n/a" : p.sem.toFixed(2)],
  ];
  const cw = W / 3;
  stats.forEach(([k, v], idx) => {
    const x = M + (idx % 3) * cw;
    const yy = y + Math.floor(idx / 3) * 34;
    page.drawText(safe(k), { x, y: A4[1] - yy - 8, size: 8, font: f.r, color: MUTED });
    page.drawText(safe(v), { x, y: A4[1] - yy - 22, size: 12, font: f.b, color: INK });
  });
  y += 72;
  const poor = p.items.filter((it) => it.quality === "POOR").length;
  const strong = p.items.filter((it) => it.quality === "STRONG").length;
  T(`Item quality: ${strong} strong, ${p.items.length - strong - poor} average, ${poor} poor (flagged for revision).`, M, 9, f.r, MUTED, W); y += 22;

  // --- CO attainment
  const a = i.attainment;
  T(`2. Course outcome attainment (target ${a.target}%)`, M, 11, f.b); y += 18;
  const barX = M + 270, barW = 150;
  for (const c of a.courseOutcomes) {
    ensure(34);
    T(c.code, M, 10, f.b); T(c.description || "(not described in syllabus)", M + 40, 8.5, f.r, MUTED, 222);
    page.drawRectangle({ x: barX, y: A4[1] - y - 10, width: barW, height: 8, color: rgb(0.93, 0.93, 0.95) });
    if (c.percent !== null) page.drawRectangle({ x: barX, y: A4[1] - y - 10, width: Math.max(1, (barW * c.percent) / 100), height: 8, color: c.met ? OK : BAD });
    page.drawLine({ start: { x: barX + (barW * a.target) / 100, y: A4[1] - y - 12 }, end: { x: barX + (barW * a.target) / 100, y: A4[1] - y + 2 }, thickness: 0.8, color: INK });
    T(c.percent === null ? "no items" : `${c.percent.toFixed(1)}%  ${c.met ? "MET" : "BELOW TARGET"}`, barX + barW + 8, 9, f.b, c.percent === null ? MUTED : c.met ? OK : BAD);
    y += 12;
    T(`${c.items} item(s), ${c.earned} / ${c.possible} pts${c.programOutcomes.length ? `  |  supports PO ${c.programOutcomes.join(", ")}` : ""}`, M + 40, 7.5, f.r, MUTED); y += 14;
  }
  if (!a.courseOutcomes.length) { T("No course outcomes are linked to this exam's questions.", M, 9, f.r, MUTED); y += 14; }
  if (a.unmappedItems) { T(`${a.unmappedItems} question(s) are not mapped to any outcome.`, M, 8.5, f.r, MUTED); y += 12; }
  y += 8;

  // --- PO roll-up
  ensure(60);
  T("3. Program outcome roll-up", M, 11, f.b); y += 18;
  const mapped = a.programOutcomes.filter((x) => x.percent !== null);
  if (!mapped.length) { T("No program outcomes are supported by the assessed course outcomes.", M, 9, f.r, MUTED); y += 14; }
  for (const po of a.programOutcomes) {
    if (po.percent === null) continue;
    ensure(16);
    T(`PO ${po.code}`, M, 9.5, f.b); T(po.description, M + 40, 8.5, f.r, MUTED, 222);
    page.drawRectangle({ x: barX, y: A4[1] - y - 9, width: barW, height: 7, color: rgb(0.93, 0.93, 0.95) });
    page.drawRectangle({ x: barX, y: A4[1] - y - 9, width: Math.max(1, (barW * po.percent) / 100), height: 7, color: po.met ? OK : BAD });
    T(`${po.percent.toFixed(1)}%  via ${po.contributingCOs.join(", ")}`, barX + barW + 8, 8.5, f.r, INK);
    y += 16;
  }
  y += 10;

  // --- verdict + sign-off
  ensure(110);
  rule(); y += 12;
  const flagged = a.belowTarget;
  T(flagged.length ? `Action required: ${flagged.join(", ")} below the ${a.target}% target. Review teaching and assessment for these outcomes.` : "All measured course outcomes met the target.", M, 9.5, f.b, flagged.length ? BAD : OK, W); y += 40;
  for (const [idx, label] of ["Prepared by (faculty)", "Reviewed by (Program Chair / Dean)"].entries()) {
    const x = M + idx * (W / 2);
    page.drawLine({ start: { x, y: A4[1] - y }, end: { x: x + W / 2 - 20, y: A4[1] - y }, thickness: 0.6, color: MUTED });
    page.drawText(label, { x, y: A4[1] - y - 11, size: 8, font: f.r, color: MUTED });
  }
  const pages = doc.getPages();
  pages.forEach((pg, n) => pg.drawText(`Generated ${i.generatedAt.toISOString().slice(0, 10)}  |  ${BRAND.name} - ${BRAND.institution}  |  page ${n + 1}/${pages.length}`, { x: M, y: 20, size: 7, font: f.r, color: MUTED }));
  return doc.save();
}
