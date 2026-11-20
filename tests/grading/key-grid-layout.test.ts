import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gridTrackRem } from "@/lib/grading/key-grid";

const source = readFileSync("src/components/grading/KeyEditor.tsx", "utf8");
const bubbleGrid = source.slice(source.indexOf("function BubbleGrid"));

describe("answer-key bubble grid layout", () => {
  it("lays rows out on grid tracks, not CSS columns that let wide rows collide", () => {
    expect(bubbleGrid).not.toMatch(/columns-\d/);
    expect(bubbleGrid).toMatch(/gridTemplateColumns/);
    expect(bubbleGrid).toMatch(/\bgrid\b/);
  });
  it("keeps each row on one line and its hooks intact", () => {
    for (const hook of ["bubble-grid", "key-row-", "flex-nowrap", "Bonus: full credit", ">★<", ">any<"]) expect(bubbleGrid).toContain(hook);
  });
  it("lets the bubble group wrap its ★ / any controls under the bubbles on phones instead of overflowing the card", () => {
    expect(bubbleGrid).toMatch(/min-w-0 flex-wrap[^"]*"[^>]*role="group"/);
    expect(bubbleGrid).toContain("min(100%,");
  });
  it("widens the minimum track with the widest row (A-D, A-F, A-J)", () => {
    expect(gridTrackRem(4)).toBeGreaterThanOrEqual(14.5);
    expect(gridTrackRem(6)).toBeGreaterThanOrEqual(18);
    expect(gridTrackRem(6)).toBeGreaterThan(gridTrackRem(4));
    expect(gridTrackRem(10)).toBeGreaterThan(gridTrackRem(6));
  });
  it("never goes below the 4-option track, even for a short or empty key", () => {
    expect(gridTrackRem(0)).toBe(gridTrackRem(4));
    expect(gridTrackRem(2)).toBe(gridTrackRem(4));
  });
});
