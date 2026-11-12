/** VERITAS serves a single institution; its shared workspace is provisioned automatically on first sign-in. */
export const DEFAULT_ORG_NAME = "University of San Agustin • Iloilo City";

export type AutoJoin = "teacher" | "viewer" | "off";
/** OMR_AUTO_JOIN: role given to verified institutional accounts that open VERITAS for the first time. */
export function parseAutoJoin(raw: string | undefined | null): AutoJoin {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "viewer" || v === "off" ? v : "teacher";
}
