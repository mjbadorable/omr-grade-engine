import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPdfText, itemsToLines, parseSyllabusPdf, parseSyllabusText } from "@/lib/syllabus/parse-syllabus";
import { SyllabusSchema } from "@/lib/syllabus/types";
import { IT321_LINES, IT321_TEXT } from "./fixtures/it321";

describe("parseSyllabusText: USA syllabus layout", () => {
  const { syllabus: s, warnings } = parseSyllabusText(IT321_TEXT);

  it("extracts the course header and term", () => {
    expect(s.courseCode).toBe("IT 321");
    expect(s.courseTitle).toBe("Information Assurance and Security 1");
    expect(s.term).toMatch(/1st Semester, A\.Y\. 2025-2026/);
  });

  it("extracts PO A–I", () => {
    expect(s.programOutcomes.map((p) => p.code)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    expect(s.programOutcomes[0].description).toMatch(/^Apply knowledge of computing/);
  });

  it("extracts CO1–CO4 and their PO links", () => {
    expect(s.courseOutcomes.map((c) => c.code)).toEqual(["CO1", "CO2", "CO3", "CO4"]);
    expect(s.courseOutcomes[0].programOutcomes).toEqual(["A", "E"]);
    expect(s.courseOutcomes[2].programOutcomes).toEqual(["A", "C", "I"]);
    expect(s.courseOutcomes[3].description).toMatch(/^Evaluate security policies/);
    expect(s.courseOutcomes[3].description).not.toMatch(/\|/);
  });

  it("extracts nine modules, grouped Prelim 1–3 / Midterm 4–6 / Final 7–9", () => {
    expect(s.modules).toHaveLength(9);
    expect(s.modules.map((m) => m.period)).toEqual(["PRELIM", "PRELIM", "PRELIM", "MIDTERM", "MIDTERM", "MIDTERM", "FINAL", "FINAL", "FINAL"]);
    const m3 = s.modules[2];
    expect(m3.title).toBe("Security Risk Management");
    expect(m3.courseOutcomes).toEqual(["CO1", "CO4"]);
    expect(m3.topics).toEqual(["Risk assessment", "Risk treatment"]);
    expect(m3.hours).toBe(6);
    expect(s.modules[6].courseOutcomes).toEqual(["CO2", "CO3"]);
  });

  it("extracts lecture / lab weighting and components", () => {
    expect(s.gradingPolicy.lectureWeight).toBe(67);
    expect(s.gradingPolicy.labWeight).toBe(33);
    expect(s.gradingPolicy.source).toBe("syllabus");
    expect(s.gradingPolicy.components).toContainEqual({ name: "Major Exam", weight: 50, group: "lecture" });
    expect(s.gradingPolicy.components).toContainEqual({ name: "Laboratory Exam", weight: 30, group: "lab" });
  });

  it("produces a schema-valid syllabus with no warnings for a complete document", () => {
    expect(SyllabusSchema.safeParse(s).success).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe("parseSyllabusText: resilience", () => {
  it("reads the header from a bare first line and falls back to the CLASE grading standard", () => {
    const { syllabus, warnings } = parseSyllabusText("IT321 Information Assurance and Security 1\nModule 1: Intro\n- topic\n");
    expect(syllabus.courseCode).toBe("IT 321");
    expect(syllabus.courseTitle).toBe("Information Assurance and Security 1");
    expect(syllabus.gradingPolicy).toMatchObject({ lectureWeight: 67, labWeight: 33, source: "default" });
    expect(warnings.join(" ")).toMatch(/CLASE/);
    expect(warnings.join(" ")).toMatch(/program outcomes/);
    expect(warnings.join(" ")).toMatch(/course outcomes/);
  });

  it("joins wrapped outcome lines and accepts inline 'PO A, C' links and 'A.' style POs", () => {
    const text = [
      "Course Code: CS 101", "Course Title: Intro", "Program Outcomes",
      "A. Apply knowledge of computing", "and mathematics.", "B. Analyze problems.",
      "Course Outcomes", "CO 1: Explain basics of the field that", "continues here (PO A, B)", "CO2 - Build things PO B",
    ].join("\n");
    const { syllabus: s } = parseSyllabusText(text);
    expect(s.programOutcomes.map((p) => p.code)).toEqual(["A", "B"]);
    expect(s.programOutcomes[0].description).toBe("Apply knowledge of computing and mathematics.");
    expect(s.courseOutcomes[0]).toMatchObject({ code: "CO1", programOutcomes: ["A", "B"] });
    expect(s.courseOutcomes[0].description).toBe("Explain basics of the field that continues here");
    expect(s.courseOutcomes[1]).toMatchObject({ code: "CO2", programOutcomes: ["B"] });
  });

  it("does not mistake words starting with PO/CO for outcomes", () => {
    const { syllabus: s } = parseSyllabusText("Program Outcomes\nPOINTS are awarded per item\nPO A Apply knowledge\nCourse Outcomes\nCOMPUTING is broad\nCO1 Explain things");
    expect(s.programOutcomes.map((p) => p.code)).toEqual(["A"]);
    expect(s.courseOutcomes.map((c) => c.code)).toEqual(["CO1"]);
  });

  it("warns about missing modules", () => {
    const { warnings } = parseSyllabusText(IT321_LINES.filter((l) => !/^Module [79]/.test(l)).join("\n"));
    expect(warnings.join(" ")).toMatch(/Modules not found: 7, 9/);
  });
});

describe("PDF extraction", () => {
  it("reconstructs lines and table cells from positioned PDF text", () => {
    const item = (str: string, x: number, y: number, width: number) => ({ str, transform: [10, 0, 0, 10, x, y], width });
    const lines = itemsToLines([item("CO1", 40, 700, 18), item("Explain things", 70, 700, 70), item("A, E", 400, 700, 20), item("Module 1", 40, 680, 40)]);
    expect(lines).toEqual(["CO1 Explain things | A, E", "Module 1"]);
  });

  it("round-trips a real PDF (pdf-lib → pdfjs → parser)", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let page = doc.addPage();
    let y = 800;
    for (const line of IT321_LINES) {
      if (y < 40) { page = doc.addPage(); y = 800; }
      // render table cells as separated columns like a real table
      let x = 40;
      for (const c of line.split(" | ")) { page.drawText(c, { x, y, size: 9, font }); x += font.widthOfTextAtSize(c, 9) + 30; }
      y -= 13;
    }
    const bytes = await doc.save();
    const loader = async () => (await import("pdfjs-dist/legacy/build/pdf.mjs")) as never;
    const text = await extractPdfText(bytes, loader);
    expect(text).toContain("Course Code: IT 321");
    const { syllabus: s, warnings } = await parseSyllabusPdf(bytes, loader);
    expect(s.courseCode).toBe("IT 321");
    expect(s.courseOutcomes.map((c) => c.code)).toEqual(["CO1", "CO2", "CO3", "CO4"]);
    expect(s.courseOutcomes[2].programOutcomes).toEqual(["A", "C", "I"]);
    expect(s.modules).toHaveLength(9);
    expect(s.gradingPolicy.source).toBe("syllabus");
    expect(warnings).toEqual([]);
  }, 30_000);
});
