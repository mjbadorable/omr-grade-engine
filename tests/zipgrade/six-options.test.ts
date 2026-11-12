import { describe, expect, it } from "vitest";
import { keyFromTemplate, updateRule } from "@/lib/grading/answer-key";
import { distributionRows } from "@/lib/grading/item-distribution";
import { analyzeItems } from "@/lib/grading/item-analysis";
import { gridRows, toggleRowBubble } from "@/lib/grading/key-grid";
import { paperBubbles } from "@/lib/grading/paper-review";
import { rescoreBatch } from "@/lib/grading/scorer";
import type { ChoiceRule, ScanInput } from "@/lib/grading/types";
import { computeLayout } from "@/lib/omr/layout-engine";
import { DEFAULT_SETTINGS } from "@/lib/omr/presets";

/** 60 questions, six choices (A–F) → template → key, as the designer would produce them. */
const template = computeLayout({ ...DEFAULT_SETTINGS, templateId: "tpl-six", columns: 4, sections: [{ id: "s1", name: "", type: "mcq", questionCount: 60, optionCount: 6, optionStyle: "letters" }] }).template;
const labels = ["A", "B", "C", "D", "E", "F"];

describe("6-option (A–F) sections in Grade", () => {
  it("the key editor grid has all six bubbles per row and F is clickable", () => {
    const key = keyFromTemplate(template);
    const row = gridRows(key, null)[0];
    expect(row.rule!.optionLabels).toEqual(labels);
    expect(row.perm).toEqual([0, 1, 2, 3, 4, 5]);
    const f = toggleRowBubble(row, 5) as Pick<ChoiceRule, "correct" | "mode">;
    expect(f.correct).toEqual([5]);
    expect(toggleRowBubble({ ...row, rule: { ...row.rule!, correct: [5] } }, 0)).toMatchObject({ correct: [0, 5], mode: "ANY_MATCH" });
  });

  it("scoring and item analysis handle option F, and the distribution lists A–F plus Blank", () => {
    let key = keyFromTemplate(template);
    key = updateRule(key, 1, { correct: [5], points: 1, negative: 0 } as Partial<ChoiceRule>);
    const answer = (marked: number[]): ScanInput["fields"]["answers"] => [{ questionNumber: 1, marked, labels: marked.map((i) => labels[i]), uncertain: false }];
    const picks = [[5], [5], [5], [4], [0], [], [5], [2]];
    const scans: ScanInput[] = picks.map((m, i) => ({ sheetId: `s${i}`, fields: { rollNumber: String(i), rollDigits: [], examSet: null, answers: answer(m), numeric: [], matrix: [], conflicts: [] } }));
    const sheets = rescoreBatch(scans, key);
    expect(sheets.map((s) => s.items[0].scoreEarned + 0)).toEqual([1, 1, 1, 0, 0, 0, 1, 0]);
    const item = analyzeItems(sheets, key).items.find((i) => i.questionNumber === 1)!;
    const rows = distributionRows(item);
    expect(rows.map((r) => r.label)).toEqual([...labels, "Blank"]);
    expect(rows.find((r) => r.label === "F")).toMatchObject({ count: 4, isKey: true, level: "key" });
    expect(rows.find((r) => r.label === "Blank")!.count).toBe(1);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(8);
  });

  it("paper view shows six bubbles with the right colours", () => {
    const b = paperBubbles({ selected: [4], correct: [5], isCorrect: false, status: "INCORRECT", notes: [] }, { optionLabels: labels });
    expect(b.map((x) => x.label)).toEqual(labels);
    expect(b.map((x) => x.visual)).toEqual(["plain", "plain", "plain", "plain", "wrong-marked", "missed-correct"]);
  });
});
