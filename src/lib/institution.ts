/** VERITAS serves a single institution; its shared workspace is provisioned automatically on first sign-in. */
export const DEFAULT_ORG_NAME = "University of San Agustin • Iloilo City";

export type AutoJoin = "teacher" | "viewer" | "off";
/**
 * OMR_AUTO_JOIN: role given automatically to a verified institutional account that opens VERITAS.
 * Default and fallback is "off": students share the @usa.edu.ph domain, so nobody joins without being
 * pre-authorized or approved by an admin. "teacher" / "viewer" must be chosen explicitly.
 */
export function parseAutoJoin(raw: string | undefined | null): AutoJoin {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "teacher" || v === "viewer" ? v : "off";
}
