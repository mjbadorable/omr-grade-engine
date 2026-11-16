import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { generatePdf } from "@/lib/omr/pdf-generator";
import { buildSampleExam } from "@/lib/samples/sample-kit";

const { template } = buildSampleExam();
const MM = 72 / 25.4;
const sizes = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getSize());

describe("generatePdf print layouts", () => {
  it("1-up (the default) is unchanged: one page per template page at paper size", async () => {
    const s = await sizes(await generatePdf(template));
    expect(s).toHaveLength(template.pages.length);
    expect(s[0].width).toBeCloseTo(template.paper.widthMm * MM, 1);
    expect(s[0].height).toBeCloseTo(template.paper.heightMm * MM, 1);
    expect(await generatePdf(template)).toEqual(await generatePdf(template, { perPage: 1 }));
  });
  it("2-up and 4-up put copies of each sheet page on one page, keeping page count", async () => {
    for (const n of [2, 4] as const) expect(await sizes(await generatePdf(template, { perPage: n }))).toHaveLength(template.pages.length);
    const [two] = await sizes(await generatePdf(template, { perPage: 2 }));
    expect(two.width).toBeGreaterThan(two.height);
    const [four] = await sizes(await generatePdf(template, { perPage: 4 }));
    expect(four.height).toBeGreaterThan(four.width);
  });
  it("still embeds the template coordinates so a printed sheet carries its own map", async () => {
    const doc = await PDFDocument.load(await generatePdf(template, { perPage: 4 }));
    const attached = doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFDict && o.has(PDFName.of("EF")));
    expect(attached).toBe(true);
  });
  it("high-contrast changes the output, standard does not", async () => {
    const std = await generatePdf(template, { darkness: "standard" });
    expect(std).toEqual(await generatePdf(template));
    expect(await generatePdf(template, { darkness: "high" })).not.toEqual(std);
  });
});
