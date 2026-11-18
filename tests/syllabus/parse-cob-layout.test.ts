import { describe, expect, it } from "vitest";
import { parseSyllabusPages, parseSyllabusText, type PdfPageItems } from "@/lib/syllabus/parse-syllabus";
import { SyllabusSchema } from "@/lib/syllabus/types";
import fixture from "./fixtures/hm5-items.json";
import { IT321_LINES, IT321_TEXT } from "./fixtures/it321";

/** Positioned text of the real USA COB/COC BSHM "HM 5/HM5A" syllabus template, pages 1–7. */
const hm5Pages = (): PdfPageItems[] => (fixture.pages as { width: number; height: number; items: [string, number, number, number, number][] }[])
  .map((p) => ({ width: p.width, height: p.height, items: p.items.map(([str, x, y, w, size]) => ({ str, x, y, w, size })) }));

const FILE = "1st Sem AY 2025-2026 UPDATED-HM5-Syllabi-Template-Pure-Lec_Lab.docx.pdf";
const { syllabus: s, warnings } = parseSyllabusPages(hm5Pages(), { fileName: FILE });
const mod = (n: number) => s.modules.find((m) => m.number === n)!;

describe("COB/COC HM 5/HM5A syllabus: course overview (cells and the title strip)", () => {
  it("reads title and code from the course specification instead of 'UNKNOWN · Untitled course'", () => {
    expect(s.courseCode).toBe("HM5/HM5A");
    expect(s.courseTitle).toBe("Applied Business Tools & Technologies in Hospitality");
  });
  it("takes the term from the file name when the document itself does not state it", () => {
    expect(s.term).toBe("1st Sem AY 2025-2026");
    expect(parseSyllabusPages(hm5Pages()).syllabus.term).toBe("");
  });
  it("reads the horizontal table cells: college, department, level, credit units, program", () => {
    expect(s.overview).toEqual({
      college: "College of Business",
      department: "Department of Hospitality Management",
      program: "BSHM",
      courseLevel: "Second Year Level",
      creditUnits: "2 units/lec; 3 units/lab",
    });
  });
});

describe("COB/COC HM 5/HM5A syllabus: PEO | PO share a row", () => {
  it("keeps only the PO column (A–H) and does not leak the PEO list into it", () => {
    expect(s.programOutcomes.map((p) => p.code)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(s.programOutcomes[0].description).toBe("Demonstrate knowledge of tourism industry, local tourism products and services");
    expect(s.programOutcomes[5].description).toBe("Demonstrate administrative and managerial skills in a service-oriented business organization");
    expect(s.programOutcomes.map((p) => p.description).join(" ")).not.toMatch(/Practicing Hospitality Management professionals|After 3 to 5 years/);
  });
  it("reads the Augustinian graduate attributes (AGA A–C)", () => {
    expect(s.graduateAttributes).toEqual([
      { code: "A", description: "A transformative community builder oriented towards God." },
      { code: "B", description: "A restless critical and creative thinker." },
      { code: "C", description: "A social communicator of the Truth." },
    ]);
  });
});

describe("COB/COC HM 5/HM5A syllabus: course outcomes with AGA and PO link columns", () => {
  it("finds CO1–CO3 as separate outcomes (CO3 no longer swallows pages 3–10)", () => {
    expect(s.courseOutcomes.map((c) => c.code)).toEqual(["CO1", "CO2", "CO3"]);
    expect(s.courseOutcomes[0].description).toBe("Apply technological tools and systems relevant to the hospitality industry");
    expect(s.courseOutcomes[1].description).toBe("Produce hospitality-related documents and reports using digital tools, adhering to professional formats, and ethical practices");
    expect(s.courseOutcomes[2].description).toBe("Evaluate the integration of current technological innovations");
    for (const c of s.courseOutcomes) expect(c.description.length).toBeLessThan(200);
  });
  it("reads each outcome's PO Code Link(s) and AGA Link(s) from their own columns", () => {
    expect(s.courseOutcomes.map((c) => c.programOutcomes)).toEqual([["A", "D", "E"], ["B", "D", "G"], ["C", "F", "H"]]);
    expect(s.courseOutcomes.map((c) => c.agaLinks)).toEqual([["B", "C"], ["A", "B", "C"], ["A", "B", "C"]]);
  });
});

describe("COB/COC HM 5/HM5A syllabus: modules M0–M6 grouped by PRELIM / MIDTERM / FINALS", () => {
  it("finds M0 to M6 with their explicit periods (not 1-3 / 4-6 / 7-9)", () => {
    expect(s.modules.map((m) => [m.number, m.period])).toEqual([
      [0, "PRELIM"], [1, "PRELIM"], [2, "PRELIM"], [3, "MIDTERM"], [4, "MIDTERM"], [5, "FINAL"], [6, "FINAL"],
    ]);
  });
  it("treats M0 as an unassessed orientation module", () => {
    expect(mod(0).title).toBe("Introduction to the Augustinian Values");
    expect(mod(0).assessed).toBe(false);
    expect(mod(0).courseOutcomes).toEqual([]);
    expect(mod(0).learningOutcomes).toHaveLength(6);
    expect(mod(0).learningOutcomes![0]).toEqual({ code: "LO 0.1", description: "The University Vision, Mission, Core Values and Outcomes, Augustinian graduate attributes" });
    expect(mod(0).hours).toBeUndefined();
  });
  it("assessed modules carry title, topics, CO links and learning outcomes", () => {
    const m1 = mod(1);
    expect(m1.assessed).toBe(true);
    expect(m1.title).toBe("Overview of Business Tools and Technologies in Hospitality");
    expect(m1.topics).toEqual(["Role of Technology in Hospitality Operations and Front Office Systems", "Productivity Tools for Hospitality", "Digital Communication and Collaboration Platforms"]);
    expect(m1.courseOutcomes).toEqual(["CO1", "CO2", "CO3"]);
    expect(m1.learningOutcomes!.map((l) => l.code)).toEqual(["LO 1.1", "LO 1.2", "LO 1.3", "LO 1.4", "LO 1.5", "LO 1.6"]);
    expect(m1.learningOutcomes![0].description).toBe("Examine how technology enhances tourism operations and the functions of front office systems.");
  });
  it("splits each assessed module into LECTURE and LABORATORY with TLA, assessment tasks and hours", () => {
    const m1 = mod(1);
    expect(m1.lecture).toEqual({ tla: ["Lecture discussion", "Case Study Analysis"], assessments: ["Quiz", "Group Activity"], hours: 2 });
    expect(m1.lab).toEqual({ tla: ["Demo for the Machine Activities", "Machine Activity 1"], assessments: ["Graded Machine: Hands-on Activity 1"], hours: 6 });
    expect(m1.hours).toBe(8);
    expect(mod(5).lecture?.hours).toBe(2);
    expect(mod(5).lab?.hours).toBe(7);
    expect(mod(4).lecture?.tla).toEqual(["Lecture discussion", "Encode/Decode worksheet", "Flight Availability Structure Analysis", "PNR Structure Analysis", "Interactive Cards"]);
  });
  it("stitches a module that continues across a page break (M2 and M4)", () => {
    const m2 = mod(2);
    expect(m2.topics).toEqual(["Introduction to Automation in Hospitality Industry Operations", "Automated Booking and Scheduling Systems", "Email Automation and Communication Flows"]);
    expect(m2.learningOutcomes!.map((l) => l.code)).toEqual(["LO 2.1", "LO 2.2", "LO 2.3", "LO 2.3", "LO 2.4", "LO 2.5"]);
    expect(m2.lecture?.hours).toBe(2);
    expect(m2.lab?.hours).toBe(7);
    expect(mod(4).lab?.hours).toBe(8);
    expect(mod(4).learningOutcomes!.map((l) => l.code)).toEqual(["LO 4.1", "LO 4.2", "LO 4.3", "LO 4.4", "LO 4.5", "LO 4.6"]);
  });
  it("does not let one module's text bleed into another", () => {
    for (const m of s.modules) {
      const own = (m.learningOutcomes ?? []).every((l) => l.code.startsWith(`LO ${m.number}.`));
      expect(own, `M${m.number} learning outcomes`).toBe(true);
      // a bled module would carry thousands of characters; M0's single orientation objective is ~170
      expect(m.topics.every((t) => t.length < 250), `M${m.number} topics`).toBe(true);
    }
  });
});

describe("COB/COC HM 5/HM5A syllabus: examination coverage", () => {
  it("reads PRELIM / MIDTERM / FINALS EXAMINATION with hours and cumulative module coverage", () => {
    expect(s.exams).toEqual([
      { period: "PRELIM", title: "Prelim Examination", hours: 3, coverage: [1, 2] },
      { period: "MIDTERM", title: "Midterm Examination", hours: 3, coverage: [1, 2, 3, 4] },
      { period: "FINAL", title: "Finals Examination", hours: 3, coverage: [1, 2, 3, 4, 5, 6] },
    ]);
  });
});

describe("COB/COC HM 5/HM5A syllabus: result contract", () => {
  it("is a schema-valid Syllabus (and so valid for the Convex upsert)", () => {
    expect(SyllabusSchema.safeParse(s).success).toBe(true);
  });
  it("only warns about what is genuinely missing (the lecture/lab split), not the old failures", () => {
    expect(warnings.join("\n")).not.toMatch(/Course code|Course title|program outcomes|course outcomes|No modules/i);
    expect(warnings.some((w) => /Grading weights not found/.test(w))).toBe(true);
  });
});

describe("fallback to the existing line parser", () => {
  /** Lay the synthetic CLASE lines out as positioned items (cells split on " | "). */
  const claseAsPages = (): PdfPageItems[] => [{
    width: 612, height: 792,
    items: IT321_LINES.flatMap((line, i) => {
      let x = 40;
      return line.split(" | ").map((c) => { const it = { str: c, x, y: 760 - i * 12, w: c.length * 5, size: 9 }; x += c.length * 5 + 30; return it; });
    }),
  }];
  it("leaves a CLASE-format syllabus to the line parser, with identical results", () => {
    const viaPages = parseSyllabusPages(claseAsPages()).syllabus;
    const direct = parseSyllabusText(IT321_TEXT).syllabus;
    expect(viaPages.courseCode).toBe("IT 321");
    expect(viaPages.modules).toHaveLength(9);
    expect(viaPages.modules.map((m) => m.period)).toEqual(direct.modules.map((m) => m.period));
    expect(viaPages.overview).toBeUndefined();
    expect(viaPages.exams).toBeUndefined();
  });
});
