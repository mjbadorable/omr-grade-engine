/**
 * Saved custom grading scales (localStorage). Lets teachers create, name, save,
 * reuse, and delete their own custom grading scales across exams.
 */
import type { GradeBand } from "@/lib/grading/types";

export const CUSTOM_SCALES_KEY = "omr:customScales";
export const MAX_CUSTOM_SCALES = 30;
export const MAX_SCALE_NAME = 60;

export interface CustomScale {
  id: string;
  name: string;
  bands: GradeBand[];
  createdAt: number;
}

function uid(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `scale-${Date.now().toString(36)}-${r}`;
}

function readAll(): CustomScale[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SCALES_KEY);
    return raw ? (JSON.parse(raw) as CustomScale[]) : [];
  } catch {
    return [];
  }
}

function writeAll(scales: CustomScale[]): void {
  try {
    localStorage.setItem(CUSTOM_SCALES_KEY, JSON.stringify(scales));
  } catch {
    /* quota / private mode */
  }
}

export function listCustomScales(): CustomScale[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function saveCustomScale(input: { name: string; bands: readonly GradeBand[] }): CustomScale {
  const name = input.name.trim();
  if (!name) throw new Error("Scale name is required.");
  if (name.length > MAX_SCALE_NAME) throw new Error(`Scale name must be at most ${MAX_SCALE_NAME} characters.`);
  const existing = readAll();
  if (existing.length >= MAX_CUSTOM_SCALES) throw new Error(`At most ${MAX_CUSTOM_SCALES} custom scales can be saved.`);
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A custom scale with this name already exists.");
  }
  const created: CustomScale = {
    id: uid(),
    name,
    bands: input.bands.map((b) => ({ label: b.label, minPercent: b.minPercent })),
    createdAt: Date.now(),
  };
  writeAll([created, ...existing]);
  return created;
}

export function deleteCustomScale(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}

function sameBands(a: readonly GradeBand[], b: readonly GradeBand[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.label === b[i].label && x.minPercent === b[i].minPercent);
}

export function findMatchingCustomScale(bands: readonly GradeBand[]): CustomScale | null {
  return readAll().find((s) => sameBands(s.bands, bands)) ?? null;
}
