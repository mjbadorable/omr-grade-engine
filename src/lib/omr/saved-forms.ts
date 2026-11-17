/**
 * Saved Answer Sheets library & URL-safe form sharing for the Sheet Designer.
 * Lets coordinators save standardized bubble-sheet configurations locally and share
 * a 1-click `/designer?form=...` link validated strictly through LayoutSettingsSchema.
 */
import { normalizeSettings } from "@/lib/omr/columns";
import { LayoutSettingsSchema, type LayoutSettings } from "@/lib/omr/schema";
import { z } from "zod";

export const CUSTOM_FORMS_KEY = "omr:savedForms";
export const FORMS_CHANGED_EVENT = "veritas:forms-changed";
export const MAX_SAVED_FORMS = 30;
export const MAX_FORM_NAME = 60;
export const MAX_SHARED_FORM_TOKEN = 16_000;

export interface SavedSheetForm {
  id: string;
  name: string;
  settings: LayoutSettings;
  createdAt: number;
}

const SharedFormPayloadSchema = z.object({
  v: z.literal(1),
  name: z.string().max(MAX_FORM_NAME).optional(),
  settings: LayoutSettingsSchema,
});

function uid(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `form-${Date.now().toString(36)}-${r}`;
}

function readAll(): SavedSheetForm[] {
  try {
    const raw = localStorage.getItem(CUSTOM_FORMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedSheetForm => (
      !!item
      && typeof item === "object"
      && typeof item.id === "string"
      && typeof item.name === "string"
      && typeof item.createdAt === "number"
      && LayoutSettingsSchema.safeParse(item.settings).success
    ));
  } catch {
    return [];
  }
}

function writeAll(forms: SavedSheetForm[]): void {
  try {
    localStorage.setItem(CUSTOM_FORMS_KEY, JSON.stringify(forms));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(FORMS_CHANGED_EVENT));
    }
  } catch {
    /* quota / private mode */
  }
}

export function listSavedForms(): SavedSheetForm[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function saveSheetForm(input: { name: string; settings: LayoutSettings }): SavedSheetForm {
  const name = input.name.trim();
  if (!name) throw new Error("Form name is required.");
  if (name.length > MAX_FORM_NAME) {
    throw new Error(`Form name must be at most ${MAX_FORM_NAME} characters.`);
  }
  const validated = LayoutSettingsSchema.parse(input.settings);
  const existing = readAll();
  if (existing.length >= MAX_SAVED_FORMS) {
    throw new Error(`At most ${MAX_SAVED_FORMS} answer sheets can be saved.`);
  }
  if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A saved form with this name already exists.");
  }
  const created: SavedSheetForm = {
    id: uid(),
    name,
    settings: normalizeSettings(validated),
    createdAt: Date.now(),
  };
  writeAll([created, ...existing]);
  return created;
}

export function deleteSavedForm(id: string): void {
  writeAll(readAll().filter((f) => f.id !== id));
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(token: string): Uint8Array | null {
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const padded = token.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((token.length + 3) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodeSharedForm(input: { name?: string; settings: LayoutSettings }): string {
  const settings = normalizeSettings(LayoutSettingsSchema.parse(input.settings));
  const rawName = (input.name ?? settings.title ?? "Shared Answer Sheet").trim().slice(0, MAX_FORM_NAME);
  const payload = JSON.stringify({ v: 1, name: rawName || "Shared Answer Sheet", settings });
  return toBase64Url(new TextEncoder().encode(payload));
}

export function decodeSharedForm(token: string): { name: string; settings: LayoutSettings } | null {
  if (!token || token.length > MAX_SHARED_FORM_TOKEN) return null;
  const bytes = fromBase64Url(token);
  if (!bytes) return null;
  try {
    const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const parsed = SharedFormPayloadSchema.safeParse(json);
    if (!parsed.success) return null;
    const settings = normalizeSettings(parsed.data.settings);
    const name = (parsed.data.name ?? settings.title ?? "").trim() || "Shared Answer Sheet";
    return { name, settings };
  } catch {
    return null;
  }
}

export function buildShareFormUrl(origin: string, input: { name?: string; settings: LayoutSettings }): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/designer?form=${encodeSharedForm(input)}`;
}
