import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/omr/layout-engine";
import { sheetSummary } from "@/lib/omr/summary";
import { activeQuickPreset, applyQuickPreset, DEFAULT_SETTINGS, PRESETS, QUICK_PRESETS } from "@/lib/omr/presets";

describe("ZipGrade quick presets", () => {
  it("offers the three standard forms, each print-ready (valid layout, 5-digit ID, sets A/B/C/D)", () => {
    expect(QUICK_PRESETS.map((q) => q.label)).toEqual(["20-Item Quiz (Compact)", "50-Item Exam (Standard)", "100-Item Exam (Full Page)"]);
    for (const q of QUICK_PRESETS) {
      const r = computeLayout({ ...q.settings, templateId: `tpl-${q.id}` });
      expect(r.issues.filter((i) => i.severity === "error"), q.id).toEqual([]);
      expect(r.stats.questions).toBe(q.questions);
      expect(r.template.pages).toHaveLength(1);                       // one printed page
      expect(q.settings).toMatchObject({ rollDigits: 5, examSets: 4, paper: "A4" });
      expect(q.settings.sections).toEqual([expect.objectContaining({ type: "mcq", questionCount: q.questions, optionCount: 4 })]);
    }
  });
  it("is also available from the preset dropdown", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(["zg-20", "zg-50", "zg-100"]));
  });
  it("keeps the sheet identity and any title the teacher or a syllabus drop set", () => {
    const fresh = applyQuickPreset({ ...DEFAULT_SETTINGS, templateId: "tpl-abc" }, QUICK_PRESETS[1]);
    expect(fresh).toMatchObject({ templateId: "tpl-abc", title: "50-Item Exam", columns: 2 });
    const custom = applyQuickPreset({ ...DEFAULT_SETTINGS, templateId: "tpl-abc", title: "IT 321 Prelim Exam", subtitle: "Information Assurance and Security 1" }, QUICK_PRESETS[0]);
    expect(custom).toMatchObject({ title: "IT 321 Prelim Exam", subtitle: "Information Assurance and Security 1" });
    expect(custom.sections[0].questionCount).toBe(20);
  });
  it("recognises which pill is active", () => {
    expect(activeQuickPreset(applyQuickPreset(DEFAULT_SETTINGS, QUICK_PRESETS[2]))).toBe("zg-100");
    expect(activeQuickPreset(applyQuickPreset(DEFAULT_SETTINGS, QUICK_PRESETS[0]))).toBe("zg-20");
    expect(activeQuickPreset({ ...applyQuickPreset(DEFAULT_SETTINGS, QUICK_PRESETS[0]), rollDigits: 8 })).toBeNull();
  });
});

describe("quick presets replace every existing section", () => {
  const starts = PRESETS.map((p) => ({ name: p.name, settings: { ...p.settings, templateId: "tpl-x" } }));
  it.each(starts)("from “$name”: exactly one MCQ section, N questions, one page, no errors", ({ settings }) => {
    for (const q of QUICK_PRESETS) {
      const s = applyQuickPreset(settings, q);
      expect(s.sections).toHaveLength(1);
      expect(s.sections[0]).toMatchObject({ type: "mcq", questionCount: q.questions, optionCount: 4 });
      const r = computeLayout(s);
      expect(r.stats.questions).toBe(q.questions);                              // never 102 from leftover numeric Q101–102
      expect(r.template.pages).toHaveLength(1);
      expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(sheetSummary({ questions: r.stats.questions, pages: r.template.pages.length, paper: s.paper, layoutErrors: 0 }).text).toBe(`✓ ${q.questions} Questions · 1 Page (A4) · Ready to Print`);
    }
  });
  it("does not share section objects with the preset (editing one sheet cannot change the preset)", () => {
    const a = applyQuickPreset(DEFAULT_SETTINGS, QUICK_PRESETS[0]);
    expect(a.sections[0]).not.toBe(QUICK_PRESETS[0].settings.sections[0]);
  });
  it("cards carry plain-language names", () => {
    expect(QUICK_PRESETS.map((q) => `${q.questions} ${q.tagline}`)).toEqual(["20 Short Quiz", "50 Standard Exam", "100 Full Exam"]);
  });
});
