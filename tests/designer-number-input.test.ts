import { describe, expect, it } from "vitest";
import { clampDraft } from "@/components/designer/SettingsPanel";

describe("clampDraft (Designer number inputs)", () => {
  it("accepts multi-digit numbers typed freely", () => {
    expect(clampDraft("50", 1, 200)).toBe(50);
    expect(clampDraft("100", 1, 200)).toBe(100);
  });
  it("empty or garbage falls back to the minimum only when committing", () => {
    expect(clampDraft("", 1, 200)).toBe(1);
    expect(clampDraft("abc", 1, 200)).toBe(1);
    expect(clampDraft("", 0, 10)).toBe(0);      // roll digits may be 0
  });
  it("clamps into range", () => {
    expect(clampDraft("0", 1, 200)).toBe(1);
    expect(clampDraft("999", 1, 200)).toBe(200);
    expect(clampDraft("-5", 2, 10)).toBe(2);
    expect(clampDraft("7.9", 1, 20)).toBe(7);
  });
});
