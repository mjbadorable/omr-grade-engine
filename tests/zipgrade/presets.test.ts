import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/omr/layout-engine";
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
