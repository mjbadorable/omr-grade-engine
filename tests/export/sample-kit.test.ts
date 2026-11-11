/** Sample Exam Kit, end to end in Node: render → photograph → scan → reconcile → override → score → scorecard. */
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { computeClassStanding, generateScorecardsPdf } from "@/lib/export/scorecard-generator";
import { rescoreBatch } from "@/lib/grading/scorer";
import { applyOverrides, makePatch } from "@/lib/review/overrides";
import { reconcile } from "@/lib/roster/reconcile";
import { buildSampleExam, pageToSvg } from "@/lib/samples/sample-kit";
import type { CV } from "@/lib/vision/cv";
import { scanSheet } from "@/lib/vision/scan-sheet";
import { loadCv } from "../vision/helpers/cv-node";
import { frontalQuad, photograph, renderPage } from "../vision/helpers/synthetic";

let cv: CV;
beforeAll(async () => { cv = await loadCv(); });
const kit = buildSampleExam();

describe("sample kit contents", () => {
  it("is deterministic and complete", () => {
    expect(JSON.stringify(buildSampleExam())).toBe(JSON.stringify(kit));
    expect(kit.template.questionCount).toBe(20);
    expect(kit.roster.students).toHaveLength(8);
    expect(kit.students).toHaveLength(5);
    expect([...kit.key.questions.values()].every((r) => r.type === "choice" && r.correct.length === 1)).toBe(true);
  });

  it("renders every mark into the SVG", () => {
    const s = kit.students[3];
    const svg = pageToSvg(kit.template, 0, s.marks, { handwriting: { name: s.name } });
    const fills = Object.values(s.marks).filter((m) => m === "fill").length;
    expect(svg.match(/fill="#2b2b2b"\/>/g)?.length).toBe(fills + 1); // + one half-disc partial mark
    expect(svg).toContain(s.name);
  });
});

describe("kit sheets through the whole pipeline", () => {
  it("scans, reconciles, accepts a teacher correction and scores exactly", { timeout: 120000 }, async () => {
    const scans = kit.students.map((s, i) => {
      const page = renderPage(cv, kit.template, 0, 6, s.marks);
      const photo = photograph(cv, page, 6, { width: 1200, height: 1600, quad: frontalQuad(kit.template), gradientLow: 0.5, noiseSigma: 5, blur: true, seed: i + 1 });
      page.delete();
      return { sheetId: `kit-${i}`, result: scanSheet(cv, photo.frame, kit.template) };
    });
    // 1) vision: every student's roll and answers read back
    scans.forEach(({ result }, i) => {
      const s = kit.students[i];
      expect(result.qr.matchesTemplate).toBe(true);
      expect(result.fields.rollNumber).toBe(s.rollNumber);
      expect(result.fields.examSet).toBe(s.set);
      for (const a of result.fields.answers) {
        if (i === 3 && a.questionNumber === 5) continue; // the planted partial mark
        expect(a.marked, `${s.name} Q${a.questionNumber}`).toEqual([s.answers[a.questionNumber]]);
      }
    });
    // 2) roster: five matched, three absent
    const recon = reconcile(kit.roster, scans.map((s) => ({ sheetId: s.sheetId, rollNumber: s.result.fields.rollNumber })));
    expect(recon.summary).toMatchObject({ matched: 5, absent: 3, unregistered: 0, unreadable: 0 });

    // 3) student 4's partial mark is held for review, then a teacher confirms the filled answer
    const before = rescoreBatch(scans.map((s) => ({ sheetId: s.sheetId, fields: s.result.fields })), kit.key);
    expect(before[3].items[4].status).toBe("FLAGGED_CONFLICT");
    const patch = makePatch({ sheetId: "kit-3", target: "answer", questionNumber: 5, originalState: {}, overriddenOption: [kit.students[3].answers[5]], reason: "partial mark is a stray", teacherId: "t" });
    const sheets = rescoreBatch(scans.map((s) => ({ sheetId: s.sheetId, fields: applyOverrides(s.result.fields, s.sheetId === "kit-3" ? [patch] : []) })), kit.key);
    sheets.forEach((sheet, i) => {
      const expected = Object.entries(kit.students[i].answers).filter(([q, a]) => (kit.key.questions.get(+q) as { correct: number[] }).correct[0] === a).length;
      expect(sheet.correctCount, kit.students[i].name).toBe(expected);
      expect(sheet.flaggedCount).toBe(0);
    });

    // 4) scorecards for the class
    const standing = computeClassStanding(sheets);
    const pdf = await generateScorecardsPdf(sheets.map((s) => ({
      institute: "Sample School", examTitle: kit.template.title, date: "2026-11-10",
      student: { name: recon.studentBySheet.get(s.sheetId)!.name, rollNumber: s.rollNumber }, sheet: s,
      rank: standing.get(s.sheetId)!.rank, classSize: sheets.length, percentile: standing.get(s.sheetId)!.percentile,
    })));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(5);
  });
});
