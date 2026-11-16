import { beforeEach, describe, expect, it } from "vitest";
import { bandsFromRows } from "@/lib/grading/grade-scales";
import {
  deleteCustomScale,
  findMatchingCustomScale,
  listCustomScales,
  saveCustomScale,
} from "@/lib/grading/custom-scales";

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
};

describe("saved custom grading scales", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true });
  });

  it("saves, lists, matches, and deletes custom grading scales", () => {
    const bands = bandsFromRows(
      [{ label: "High Pass", from: 90 }, { label: "Pass", from: 75 }, { label: "Fail", from: 0 }],
      true,
    );
    const saved = saveCustomScale({ name: "Nursing 75%", bands });
    expect(saved.name).toBe("Nursing 75%");
    expect(listCustomScales()).toHaveLength(1);
    expect(findMatchingCustomScale(bands)?.id).toBe(saved.id);

    deleteCustomScale(saved.id);
    expect(listCustomScales()).toEqual([]);
    expect(findMatchingCustomScale(bands)).toBeNull();
  });

  it("rejects empty or duplicate scale names", () => {
    const bands = bandsFromRows([{ label: "Pass", from: 75 }, { label: "Fail", from: 0 }], false);
    expect(() => saveCustomScale({ name: "   ", bands })).toThrow(/name/i);
    saveCustomScale({ name: "STEM Cutoff", bands });
    expect(() => saveCustomScale({ name: "stem cutoff", bands })).toThrow(/exists/i);
  });
});
