/**
 * Sample Exam Kit (pure part): a ready-to-print 20-question exam, its answer key, a roster and
 * five students' marked sheets, plus an SVG renderer for those sheets. The browser part
 * (`kit-builder.ts`) rasterises the SVGs into photo-like JPEGs and zips everything.
 */
import { keyFromTemplate, updateKey } from "@/lib/grading/answer-key";
import { mulberry32 } from "@/lib/grading/simulate";
import type { AnswerKey, ChoiceRule } from "@/lib/grading/types";
import { collectBubbles, computeLayout } from "@/lib/omr/layout-engine";
import { pagePrimitives } from "@/lib/omr/primitives";
import type { LayoutSettings, OMRTemplate } from "@/lib/omr/schema";
import type { Roster } from "@/lib/roster/schema";

import { studentName } from "./names";

export { studentName };

export const SAMPLE_SETTINGS: LayoutSettings = {
  templateId: "sample-kit-20q", version: 1, title: "Sample Quiz (20 questions)", subtitle: "VERITAS - Evaluation Kit",
  paper: "A4", columns: 2, bubbleDiameterMm: 4.6, rollDigits: 6, rollStartDigit: 0, examSets: 2, nameField: true,
  sections: [
    { id: "math", name: "Mathematics", type: "mcq", questionCount: 10, optionCount: 4, optionStyle: "letters" },
    { id: "sci", name: "Science", type: "mcq", questionCount: 10, optionCount: 4, optionStyle: "letters" },
  ],
};

export type SheetMarks = Record<string, "fill" | "partial">;
export interface SampleStudent { rollNumber: string; name: string; set: string; answers: Record<number, number>; marks: SheetMarks }
export interface SampleExam { template: OMRTemplate; key: AnswerKey; roster: Roster; students: SampleStudent[] }

export function buildSampleExam(seed = 2026): SampleExam {
  const template = computeLayout(SAMPLE_SETTINGS).template;
  const rnd = mulberry32(seed);
  let key = keyFromTemplate(template, "sample-quiz");
  const q = new Map(key.questions);
  for (const [n, r] of q) {
    if (r.type !== "choice") continue;
    q.set(n, { ...r, correct: [Math.floor(rnd() * r.optionCount)], tags: { subject: n <= 10 ? "Mathematics" : "Science", section: r.tags.section } } satisfies ChoiceRule);
  }
  key = updateKey({ ...key, questions: q }, {});

  const roster: Roster = {
    schema: "omr-roster/v1", name: "Sample class 10-A", importedAt: 0,
    students: Array.from({ length: 8 }, (_, i) => ({ rollNumber: String(240101 + i), name: studentName(i, seed), section: "10-A" })),
  };
  // five students sit the quiz (three are absent); abilities spread from strong to weak
  const ability = [0.95, 0.85, 0.7, 0.55, 0.4];
  const students: SampleStudent[] = ability.map((p, s) => {
    const st = roster.students[s];
    const set = s % 2 ? "B" : "A";
    const answers: Record<number, number> = {};
    const marks: SheetMarks = {};
    for (const r of key.questions.values()) {
      if (r.type !== "choice") continue;
      const ok = rnd() < p;
      const pick = ok ? r.correct[0] : (r.correct[0] + 1 + Math.floor(rnd() * (r.optionCount - 1))) % r.optionCount;
      answers[r.questionNumber] = pick;
      marks[`p0:q${r.questionNumber}:${r.optionLabels[pick]}`] = "fill";
    }
    [...st.rollNumber].forEach((d, i) => { marks[`p0:roll:d${i}:${d}`] = "fill"; });
    marks[`p0:set:${set}`] = "fill";
    if (s === 3) marks["p0:q5:" + "ABCD"[(answers[5] + 2) % 4]] = "partial"; // one ambiguous mark for the review demo
    return { rollNumber: st.rollNumber, name: st.name, set, answers, marks };
  });
  return { template, key, roster, students };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Standalone SVG of a page (1 user unit = 1 mm) with pencil marks drawn in. */
export function pageToSvg(t: OMRTemplate, pageIndex: number, marks: SheetMarks = {}, opts: { handwriting?: { name?: string; roll?: string } } = {}): string {
  const page = t.pages[pageIndex];
  const { widthMm: W, heightMm: H } = t.paper;
  const [ox, oy] = t.paper.originMm;
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`];
  for (const p of pagePrimitives(t, page)) {
    if (p.t === "rect") parts.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.fill ?? "none"}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.strokeW}"` : ""}/>`);
    else if (p.t === "circle") parts.push(`<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="none" stroke="${p.stroke}" stroke-width="${p.strokeW}"/>`);
    else if (p.t === "line") parts.push(`<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.stroke}" stroke-width="${p.strokeW}"/>`);
    else parts.push(`<text x="${p.x}" y="${p.y}" font-family="Helvetica,Arial,sans-serif" font-size="${p.size}" font-weight="${p.bold ? 700 : 400}" text-anchor="${p.anchor}" fill="${p.fill}">${esc(p.text)}</text>`);
  }
  const r = (t.bubble.diameterMm / 2) * 0.86;
  for (const b of collectBubbles(page)) {
    const m = marks[b.id];
    if (!m) continue;
    const [cx, cy] = [b.center[0] + ox, b.center[1] + oy];
    if (m === "fill") parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#2b2b2b"/>`);
    else parts.push(`<path d="M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z" fill="#2b2b2b"/>`);
  }
  const hw = opts.handwriting;
  if (hw?.name) {
    const line = page.boxes.find((b) => b.id === "p0:field:name:line");
    if (line) parts.push(`<text x="${line.bbox.x + ox + 2}" y="${line.bbox.y + oy - 1}" font-family="'Comic Sans MS','Segoe Print',cursive" font-size="4" fill="#1d3b8a">${esc(hw.name)}</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
