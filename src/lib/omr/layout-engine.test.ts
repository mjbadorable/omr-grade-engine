import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { collectBubbles, computeLayout, parseQrPayload, validateTemplate } from "./layout-engine";
import { generatePdf } from "./pdf-generator";
import { PRESETS } from "./presets";
import type { LayoutSettings } from "./schema";
import { sha256Hex } from "./sha256";

const settingsOf = (id: string, extra: Partial<LayoutSettings> = {}): LayoutSettings => ({
  templateId: "tpl-test", ...PRESETS.find((p) => p.id === id)!.settings, ...extra,
});

describe("sha256", () => {
  it("matches FIPS test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
});

describe.each(PRESETS.map((p) => p.id))("preset %s", (id) => {
  const res = computeLayout(settingsOf(id));

  it("lays out with zero validation errors", () => {
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("is deterministic", () => {
    const again = computeLayout(settingsOf(id));
    expect(JSON.stringify(again.template)).toBe(JSON.stringify(res.template));
  });

  it("places every question exactly once", () => {
    const numbers: number[] = [];
    for (const p of res.template.pages) for (const r of p.regions) {
      if (r.kind === "mcq") numbers.push(...r.questions.map((q) => q.number));
      if (r.kind === "numeric" || r.kind === "matrix") numbers.push(r.questionNumber);
    }
    expect(numbers.sort((a, b) => a - b)).toEqual(Array.from({ length: res.template.questionCount }, (_, i) => i + 1));
  });

  it("puts reference rows every 5 answer rows and every bubble in its own cell", () => {
    for (const p of res.template.pages) {
      const g = p.referenceGrid;
      expect(g.rowYs[1] - g.rowYs[0]).toBeCloseTo(5 * res.template.bubble.rowPitchMm, 3);
      for (const b of collectBubbles(p)) {
        const [ri] = b.cell;
        expect(b.center[1]).toBeGreaterThan(g.rowYs[ri]);
        expect(b.center[1]).toBeLessThan(g.rowYs[ri + 1]);
      }
    }
  });

  it("encodes a parseable QR payload with the layout hash", () => {
    for (const p of res.template.pages) {
      const q = parseQrPayload(p.qr.payload)!;
      expect(q).toMatchObject({ templateId: "tpl-test", page: p.index, pages: res.template.pages.length, layoutHash: res.template.layoutHash });
    }
  });

  it("exports a PDF with one page per template page and the JSON embedded", async () => {
    const bytes = await generatePdf(res.template);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(res.template.pages.length);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(res.template.paper.widthMm * 72 / 25.4, 2);
    const again = await generatePdf(res.template);
    expect(sha256Hex(Array.from(again).join(","))).toBe(sha256Hex(Array.from(bytes).join(",")));
  });
});

describe("layout rules", () => {
  it("fits 200 four-option questions on one A4 page with compact bubbles", () => {
    const res = computeLayout(settingsOf("mcq-200"));
    expect(res.template.pages.length).toBe(1);
    expect(res.template.questionCount).toBe(200);
  });

  it("paginates when questions overflow", () => {
    const res = computeLayout(settingsOf("mcq-100", { columns: 1, sections: [{ id: "s", name: "", type: "mcq", questionCount: 120, optionCount: 5, optionStyle: "letters" }] }));
    expect(res.template.pages.length).toBeGreaterThan(1);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports columns that are too narrow", () => {
    const res = computeLayout(settingsOf("mcq-100", { columns: 6, bubbleDiameterMm: 6, sections: [{ id: "s", name: "", type: "numeric", questionCount: 4, digits: 8, hasSign: true, hasDecimal: true }] }));
    expect(res.issues.some((i) => i.code === "COLUMN_TOO_NARROW")).toBe(true);
  });

  it("changes the hash when geometry changes, but not the bubble ids of untouched content", () => {
    const a = computeLayout(settingsOf("mcq-100"));
    const b = computeLayout(settingsOf("mcq-100", { bubbleDiameterMm: 4.4 }));
    expect(a.template.layoutHash).not.toBe(b.template.layoutHash);
  });

  it("detects injected overlaps and out-of-margin elements", () => {
    const t = structuredClone(computeLayout(settingsOf("mcq-100")).template);
    const mcq = t.pages[0].regions.find((r) => r.kind === "mcq")!;
    if (mcq.kind !== "mcq") throw new Error();
    const [a, b] = mcq.questions[0].bubbles;
    b.bbox = { ...a.bbox, x: a.bbox.x + 0.1 };
    t.pages[0].texts[0].bbox.x = -20;
    const codes = validateTemplate(t).map((i) => i.code);
    expect(codes).toContain("OVERLAP");
    expect(codes).toContain("OUT_OF_PRINTABLE_AREA");
  });

  it("orders roll symbols by rollStartDigit", () => {
    const res = computeLayout(settingsOf("letter-tf"));
    const roll = res.template.pages[0].regions.find((r) => r.kind === "roll");
    expect(roll && roll.kind === "roll" && roll.symbols.join("")).toBe("1234567890");
  });
});
