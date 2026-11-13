import { describe, expect, it } from "vitest";
import { designerSteps } from "@/lib/omr/designer-steps";

const ok = { title: "Midterm Exam", subtitle: "IT 321", questions: 50, pages: 1, layoutErrors: 0 };
const status = (i: Parameters<typeof designerSteps>[0]) => designerSteps(i).map((s) => s.status);

describe("designerSteps", () => {
  it("returns the three numbered steps in order", () => {
    expect(designerSteps(ok).map((s) => [s.id, s.label])).toEqual([[1, "Exam Details"], [2, "Answer Sheet Setup"], [3, "Review & Download"]]);
  });

  it("marks everything done for a valid single-page sheet", () => {
    expect(status(ok)).toEqual(["done", "done", "done"]);
  });

  it("asks for an exam name; the course line is optional", () => {
    expect(status({ ...ok, title: "   " })).toEqual(["todo", "done", "todo"]);
    expect(status({ ...ok, subtitle: "" })).toEqual(["done", "done", "done"]);
  });

  it("flags a setup with no questions as still to do", () => {
    expect(status({ ...ok, questions: 0 })).toEqual(["done", "todo", "todo"]);
  });

  it("warns on setup and review when the layout does not fit", () => {
    expect(status({ ...ok, layoutErrors: 2 })).toEqual(["done", "warn", "warn"]);
  });

  it("warns on review (only) when the sheet spills onto several pages", () => {
    expect(status({ ...ok, pages: 2 })).toEqual(["done", "done", "warn"]);
  });
});
