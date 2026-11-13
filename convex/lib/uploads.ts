/** Server-side checks for files a teacher uploaded to Convex storage (scan previews). */
export const MAX_PREVIEW_BYTES = 2_000_000;
export const PREVIEW_TYPES = ["image/jpeg", "image/png"] as const;

/** Why a stored preview must be refused, or null when it is fine. `meta` is the `_storage` system document. */
export function previewProblem(meta: { size: number; contentType?: string } | null): "MISSING" | "TOO_LARGE" | "BAD_TYPE" | null {
  if (!meta) return "MISSING";
  if (meta.size > MAX_PREVIEW_BYTES) return "TOO_LARGE";
  if (!(PREVIEW_TYPES as readonly string[]).includes((meta.contentType ?? "").toLowerCase())) return "BAD_TYPE";
  return null;
}
