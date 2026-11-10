/** The current sheet template (designer → scanner → gradebook) and per-template answer keys, in localStorage. */
import { parseKey, serializeKey } from "@/lib/grading/answer-key";
import type { AnswerKey } from "@/lib/grading/types";
import { type OMRTemplate, OMRTemplateSchema } from "@/lib/omr/schema";

export const TEMPLATE_STORAGE_KEY = "omr:template";
const keyStorageKey = (layoutHash: string) => `omr:key:${layoutHash}`;

export function readStoredTemplate(): OMRTemplate | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return null;
    const p = OMRTemplateSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

export function writeStoredTemplate(t: OMRTemplate) {
  try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(t)); } catch { /* quota / private mode */ }
}

export function readStoredKey(layoutHash: string): AnswerKey | null {
  try {
    const raw = localStorage.getItem(keyStorageKey(layoutHash));
    return raw ? parseKey(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeStoredKey(layoutHash: string, k: AnswerKey) {
  try { localStorage.setItem(keyStorageKey(layoutHash), JSON.stringify(serializeKey(k))); } catch { /* ignore */ }
}
