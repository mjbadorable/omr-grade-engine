/**
 * ZipGrade colour language for a graded paper, per question:
 *   green  filled : student marked a correct bubble
 *   red    filled : student marked a wrong bubble
 *   gold   ring   : a correct bubble the student missed or skipped (shown only when the item is not fully right)
 * Options are returned in PRINTED order (what the student saw), labelled by their printed position.
 */
import type { ChoiceRule, QuestionScore } from "./types";

export type BubbleVisual = "correct-marked" | "wrong-marked" | "missed-correct" | "plain";
export interface PaperBubble { label: string; printedIndex: number; masterIndex: number; visual: BubbleVisual }

export function paperBubbles(item: Pick<QuestionScore, "selected" | "correct" | "isCorrect" | "status" | "notes">, rule: Pick<ChoiceRule, "optionLabels">, perm?: readonly number[] | null): PaperBubble[] {
  const n = rule.optionLabels.length;
  const toMaster = (p: number) => (perm && perm[p] !== undefined ? perm[p] : p);
  const fullyRight = item.status === "CORRECT";
  const bonusOrDropped = item.notes.includes("BONUS") || item.notes.includes("DROPPED");
  return Array.from({ length: n }, (_, p): PaperBubble => {
    const m = toMaster(p);
    const marked = item.selected.includes(m);
    const correct = item.correct.includes(m);
    const visual: BubbleVisual = marked ? (correct ? "correct-marked" : "wrong-marked") : correct && !fullyRight && !bonusOrDropped ? "missed-correct" : "plain";
    return { label: rule.optionLabels[p] ?? String.fromCharCode(65 + p), printedIndex: p, masterIndex: m, visual };
  });
}
