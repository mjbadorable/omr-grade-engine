import type { LayoutSettings } from "./schema";

type Preset = { id: string; name: string; settings: Omit<LayoutSettings, "templateId"> };

export const PRESETS: Preset[] = [
  {
    id: "mcq-100",
    name: "100 MCQ · 4 options · 4 columns",
    settings: {
      version: 1, title: "Unit Test Answer Sheet", subtitle: "Mathematics - Grade 10", paper: "A4",
      columns: 4, bubbleDiameterMm: 4.2, rollDigits: 5, rollStartDigit: 0, examSets: 4, nameField: true,
      sections: [{ id: "s1", name: "", type: "mcq", questionCount: 100, optionCount: 4, optionStyle: "letters" }],
    },
  },
  {
    id: "mcq-200",
    name: "200 MCQ · 4 options · 5 columns (compact)",
    settings: {
      version: 1, title: "Final Examination", subtitle: "", paper: "A4",
      columns: 5, bubbleDiameterMm: 3.6, rollDigits: 8, rollStartDigit: 0, examSets: 4, nameField: true,
      sections: [{ id: "s1", name: "", type: "mcq", questionCount: 200, optionCount: 4, optionStyle: "letters" }],
    },
  },
  {
    id: "jee",
    name: "Mixed: MCQ + numeric + matrix",
    settings: {
      version: 1, title: "Joint Mock Test", subtitle: "Physics - Chemistry", paper: "A4",
      columns: 3, bubbleDiameterMm: 4.0, rollDigits: 10, rollStartDigit: 0, examSets: 4, nameField: true,
      sections: [
        { id: "s1", name: "Physics MCQ", type: "mcq", questionCount: 30, optionCount: 4, optionStyle: "letters" },
        { id: "s2", name: "Physics Numeric", type: "numeric", questionCount: 2, digits: 4, hasSign: true, hasDecimal: true },
        { id: "s3", name: "Matrix Match", type: "matrix", questionCount: 1, rows: 4, cols: 5 },
      ],
    },
  },
  {
    id: "letter-tf",
    name: "US Letter · 50 True/False",
    settings: {
      version: 1, title: "Quiz", subtitle: "", paper: "LETTER",
      columns: 3, bubbleDiameterMm: 4.6, rollDigits: 6, rollStartDigit: 1, examSets: 0, nameField: true,
      sections: [{ id: "s1", name: "", type: "mcq", questionCount: 50, optionCount: 2, optionStyle: "true-false" }],
    },
  },
];

/**
 * ZipGrade-style one-click forms: MCQ A-D, 5-digit Student ID, Set A/B/C/D selector, name line.
 * Columns are chosen so each column holds a round number of rows on A4.
 */
export interface QuickPreset { id: string; label: string; short: string; /** plain-language size name shown on the card */ tagline: string; questions: number; settings: Omit<LayoutSettings, "templateId"> }
const zg = (questions: number, columns: number, title: string, bubble: number): Omit<LayoutSettings, "templateId"> => ({
  version: 1, title, subtitle: "", paper: "A4", columns, bubbleDiameterMm: bubble, rollDigits: 5, rollStartDigit: 0, examSets: 4, nameField: true,
  sections: [{ id: "s1", name: "", type: "mcq", questionCount: questions, optionCount: 4, optionStyle: "letters" }],
});
export const QUICK_PRESETS: readonly QuickPreset[] = [
  { id: "zg-20", label: "20-Item Quiz (Compact)", short: "20-Item Quiz", tagline: "Short Quiz", questions: 20, settings: zg(20, 2, "20-Item Quiz", 4.6) },
  { id: "zg-50", label: "50-Item Exam (Standard)", short: "50-Item Exam", tagline: "Standard Exam", questions: 50, settings: zg(50, 2, "50-Item Exam", 4.4) },
  { id: "zg-100", label: "100-Item Exam (Full Page)", short: "100-Item Exam", tagline: "Full Exam", questions: 100, settings: zg(100, 4, "100-Item Exam", 4.2) },
];
PRESETS.push(...QUICK_PRESETS.map((q) => ({ id: q.id, name: `ZipGrade-style · ${q.label}`, settings: q.settings })));

const STOCK_TITLES = new Set(["", "Unit Test Answer Sheet", "Quiz", "Final Examination", "Joint Mock Test", ...QUICK_PRESETS.map((q) => q.settings.title)]);
const STOCK_SUBTITLES = new Set(["", "Mathematics - Grade 10", "Physics - Chemistry"]);

/**
 * Apply a quick preset: a brand-new layout whose ONLY section is the preset's multiple-choice block
 * (any numeric / matrix / extra sections from the previous layout are dropped, so 100 Items is
 * exactly 100 questions on one page). Keeps the sheet identity and any title/subtitle the teacher
 * (or a syllabus drop) set.
 */
export function applyQuickPreset(current: LayoutSettings, preset: QuickPreset): LayoutSettings {
  return {
    ...preset.settings,
    sections: preset.settings.sections.map((x) => ({ ...x })),
    templateId: current.templateId,
    title: STOCK_TITLES.has(current.title) ? preset.settings.title : current.title,
    subtitle: STOCK_SUBTITLES.has(current.subtitle) ? preset.settings.subtitle : current.subtitle,
  };
}

/** Which quick preset (if any) the settings currently match: same length, columns, ID digits and sets. */
export function activeQuickPreset(s: LayoutSettings): string | null {
  const q = QUICK_PRESETS.find((p) => p.questions === s.sections.reduce((n, x) => n + x.questionCount, 0) && p.settings.columns === s.columns && s.sections.length === 1 && s.sections[0].type === "mcq" && s.rollDigits === 5 && s.examSets === 4);
  return q?.id ?? null;
}

export const DEFAULT_SETTINGS: LayoutSettings = { templateId: "tpl-draft", ...PRESETS[0].settings };
