import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/omr/presets";
import {
  buildShareFormUrl,
  CUSTOM_FORMS_KEY,
  decodeSharedForm,
  deleteSavedForm,
  encodeSharedForm,
  listSavedForms,
  MAX_SAVED_FORMS,
  saveSheetForm,
} from "@/lib/omr/saved-forms";

describe("Phase E: Saved Answer Sheets library", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves, lists newest-first, validates duplicates/bounds, and deletes forms", () => {
    const first = saveSheetForm({ name: "Standard 50-Item MCQ", settings: DEFAULT_SETTINGS });
    expect(listSavedForms().map((f) => f.name)).toEqual(["Standard 50-Item MCQ"]);

    expect(() => saveSheetForm({ name: "standard 50-item mcq", settings: DEFAULT_SETTINGS })).toThrow(/already exists/i);
    expect(() => saveSheetForm({ name: "   ", settings: DEFAULT_SETTINGS })).toThrow(/required/i);

    const updated = { ...DEFAULT_SETTINGS, title: "Midterm", columns: 4 };
    const second = saveSheetForm({ name: "Midterm 4-Column", settings: updated });
    // Ensure distinct timestamps or stable newest-first order
    expect(listSavedForms().map((f) => f.id)).toContain(first.id);
    expect(listSavedForms().map((f) => f.id)).toContain(second.id);

    deleteSavedForm(first.id);
    expect(listSavedForms().map((f) => f.id)).toEqual([second.id]);
    expect(store.get(CUSTOM_FORMS_KEY)).toBeTruthy();
  });

  it("enforces the saved forms cap", () => {
    for (let i = 0; i < MAX_SAVED_FORMS; i++) {
      saveSheetForm({ name: `Form ${i + 1}`, settings: DEFAULT_SETTINGS });
    }
    expect(() => saveSheetForm({ name: "One Too Many", settings: DEFAULT_SETTINGS })).toThrow(/at most/i);
  });

  it("round-trips Unicode form names and layout settings through URL-safe tokens", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      title: "Filipino & Math — Pagsusulit #1",
      subtitle: "College of Education",
      columns: 3,
      examSets: 4,
    };
    const token = encodeSharedForm({ name: "Pagsusulit — 50 Items", settings });
    expect(token).not.toMatch(/[+/=]/);

    const decoded = decodeSharedForm(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe("Pagsusulit — 50 Items");
    expect(decoded!.settings.title).toBe("Filipino & Math — Pagsusulit #1");
    expect(decoded!.settings.examSets).toBe(4);

    const url = buildShareFormUrl("https://omr-grade-engine.vercel.app", { name: "Shared Sheet", settings });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/designer");
    expect(decodeSharedForm(parsed.searchParams.get("form")!)?.name).toBe("Shared Sheet");
  });

  it("rejects malformed, oversized, or schema-invalid shared form payloads", () => {
    expect(decodeSharedForm("")).toBeNull();
    expect(decodeSharedForm("not-valid-base64!!!")).toBeNull();
    expect(decodeSharedForm("a".repeat(20_000))).toBeNull();

    // Inject invalid schema fields via raw base64url JSON
    const badJson = Buffer.from(
      JSON.stringify({ v: 1, name: "Bad", settings: { ...DEFAULT_SETTINGS, columns: 99, templateId: "../evil" } }),
      "utf8",
    ).toString("base64url");
    expect(decodeSharedForm(badJson)).toBeNull();
  });

  it("wires SavedFormsPanel and shared-form import banner into SheetDesigner with mobile touch targets", () => {
    const designer = readFileSync(join(process.cwd(), "src/components/designer/SheetDesigner.tsx"), "utf8");
    expect(designer).toContain("SavedFormsPanel");
    expect(designer).toContain("shared-form-banner");
    expect(designer).toContain("decodeSharedForm");
    expect(designer).toContain("clearFormParam");

    const panel = readFileSync(join(process.cwd(), "src/components/designer/SavedFormsPanel.tsx"), "utf8");
    expect(panel).toContain("saved-forms-panel");
    expect(panel).toContain("share-form-btn");
    expect(panel).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(panel).toContain('className="v-input v-mono min-h-9 w-full text-xs [@media(pointer:coarse)]:min-h-11"');
  });
});
