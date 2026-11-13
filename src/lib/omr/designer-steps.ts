/** Progress of the three designer steps (Exam Details, Answer Sheet Setup, Review & Download). */
export type StepStatus = "done" | "todo" | "warn";
export interface DesignerStep { id: 1 | 2 | 3; label: string; status: StepStatus }

export function designerSteps(i: { title: string; subtitle: string; questions: number; pages: number; layoutErrors: number }): DesignerStep[] {
  const details: StepStatus = i.title.trim() ? "done" : "todo";
  const setup: StepStatus = i.layoutErrors > 0 ? "warn" : i.questions < 1 ? "todo" : "done";
  const review: StepStatus = i.layoutErrors > 0 || i.pages > 1 ? "warn" : details === "done" && setup === "done" ? "done" : "todo";
  return [
    { id: 1, label: "Exam Details", status: details },
    { id: 2, label: "Answer Sheet Setup", status: setup },
    { id: 3, label: "Review & Download", status: review },
  ];
}
