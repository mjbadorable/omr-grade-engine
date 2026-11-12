"use client";
/**
 * Shown to signed-in @usa.edu.ph accounts that are not faculty yet (students share the domain).
 * The server already refuses every exam / key / record call for them; this explains why and lets
 * them ask an admin for access.
 */
import { useState } from "react";
import { useCloudSession } from "@/components/cloud/CloudSession";

export default function AccessBanner() {
  const s = useCloudSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!s || !s.isAuthenticated || !s.me || (s.access && !s.access.allowed)) return null;
  const a = s.workspace.access;
  if (a === "loading" || a === "member") return null;

  const ask = async () => {
    setBusy(true); setErr(null);
    try { await s.workspace.requestAccess(); } catch (e) { setErr((e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? "Could not send the request."); } finally { setBusy(false); }
  };
  return (
    <div role="status" data-testid="access-banner" data-access={a} className="border-t border-gold/40 bg-gold-tint px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-gold text-sm font-bold text-white">!</span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">Faculty Access Required</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400" data-testid="access-message">
            {a === "pending" ? `Your request for ${s.me.email ?? "this account"} is waiting for an admin. You will get access as soon as it is approved; designing sheets on this device still works.`
              : a === "rejected" ? "Your request was declined. If you are faculty, ask the EdTech Office to pre-authorize your @usa.edu.ph email, or request again."
              : "Exams, answer keys and class records are for approved University of San Agustin faculty. If you are faculty, request access and an admin will approve it."}
          </p>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        {a === "pending"
          ? <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gold-hover ring-1 ring-gold/50 dark:bg-zinc-900 dark:text-gold" data-testid="request-pending">Request sent · pending</span>
          : <button type="button" disabled={busy} onClick={ask} data-testid="request-access" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? "Sending…" : a === "rejected" ? "Request again" : "Request Faculty Access"}</button>}
      </div>
    </div>
  );
}
