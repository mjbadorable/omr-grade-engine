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

export const DEFAULT_SETTINGS: LayoutSettings = { templateId: "tpl-draft", ...PRESETS[0].settings };
