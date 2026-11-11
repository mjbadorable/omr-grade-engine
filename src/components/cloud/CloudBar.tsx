"use client";
/** Cloud status + school / exam pickers (rendered only when Convex is configured). */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { OMRTemplate } from "@/lib/omr/schema";
import { useCloudSession } from "./CloudSession";

const ClerkControls = dynamic(() => import("./ClerkControls"), { ssr: false });

const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export default function CloudBar({ localTemplate }: { localTemplate?: OMRTemplate | null }) {
  const s = useCloudSession();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  if (!s) return null;

  const exam = s.exams?.find((e) => e._id === s.selection.examId);
  const denied = s.isAuthenticated && s.access && !s.access.allowed;
  const domains = s.access?.domains ?? ["usa.edu.ph"];
  const label = s.isLoading ? "Cloud…" : !s.isAuthenticated ? "Cloud: sign in" : denied ? "Cloud: account not allowed" : exam ? `Cloud: ${exam.name}` : "Cloud: choose exam";
  const live = s.isAuthenticated && !!exam;
  const run = (f: () => Promise<unknown>) => { setErr(null); f().catch((e) => setErr(e?.data?.message ?? e?.message ?? String(e))); };

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${live ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"}`}>
        <span className={`size-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-zinc-400"}`} />
        <span className="max-w-[16rem] truncate">{label}</span>
        {s.pendingUploads > 0 && <span className="rounded bg-amber-200 px-1 text-[11px] text-amber-900">{s.pendingUploads} queued</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-96 space-y-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
          {!s.isAuthenticated ? (
            s.authMode === "clerk" ? <ClerkControls mode="signin" domains={domains} /> : s.authMode === "dev" ? (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">Development sign-in: paste a token from <code>node scripts/dev-auth.mjs token &lt;id&gt; &quot;Name&quot; email</code>.</p>
                <textarea aria-label="Dev token" className={`${input} h-20 w-full font-mono text-[11px]`} value={token} onChange={(e) => setToken(e.target.value)} />
                <button type="button" className="rounded-md bg-indigo-600 px-3 py-1 text-white" onClick={() => s.signInDev(token)} disabled={!token.trim()}>Sign in</button>
              </div>
            ) : <p className="text-xs text-zinc-500">Cloud sync is configured but no sign-in provider is set up yet (Clerk or Convex Auth). Everything keeps working locally.</p>
          ) : denied ? (
            <div className="space-y-2" data-testid="access-denied">
              <p className="text-sm text-red-700 dark:text-red-400">{s.access!.message}</p>
              <p className="text-xs text-zinc-500">Only verified {domains.map((d) => `@${d}`).join(" / ")} Google accounts can use the school&apos;s cloud. Your local work on this device is unaffected.</p>
              {s.authMode === "clerk" ? <ClerkControls mode="signout" domains={domains} /> : <button type="button" className="underline" onClick={s.signOut}>sign out</button>}
            </div>
          ) : !s.me ? <p className="text-xs text-zinc-500">Setting up your account…</p> : (
            <>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>Signed in as <b>{s.me.name ?? s.me.email}</b>{s.me.email && s.me.name ? ` (${s.me.email})` : ""}</span>
                {s.authMode === "dev" && <button type="button" className="underline" onClick={s.signOut}>sign out</button>}
                {s.authMode === "clerk" && <span className="ml-auto"><ClerkControls mode="account" domains={domains} /></span>}
              </div>
              <label className="block">School
                <select aria-label="School" className={`${input} mt-1 w-full`} value={s.selection.orgId ?? ""} onChange={(e) => s.selectOrg((e.target.value || null) as Id<"orgs"> | null)}>
                  <option value="">Choose…</option>
                  {s.orgs?.map((o) => <option key={o._id} value={o._id}>{o.name} ({o.role})</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <input aria-label="New school name" className={`${input} flex-1`} placeholder="New school name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                <button type="button" className="rounded-md border border-zinc-300 px-2 dark:border-zinc-700" disabled={!orgName.trim()} onClick={() => run(async () => { await s.createOrg(orgName); setOrgName(""); })}>Create</button>
              </div>
              {s.selection.orgId && (
                <>
                  <label className="block">Exam
                    <select aria-label="Exam" className={`${input} mt-1 w-full`} value={s.selection.examId ?? ""} onChange={(e) => s.selectExam((e.target.value || null) as Id<"exams"> | null)}>
                      <option value="">Work locally (no exam)</option>
                      {s.exams?.map((x) => <option key={x._id} value={x._id}>{x.name} · key v{x.currentKeyVersion}{localTemplate && x.layoutHash !== localTemplate.layoutHash ? " · other sheet" : ""}</option>)}
                    </select>
                  </label>
                  {["owner", "admin"].includes(s.orgs?.find((o) => o._id === s.selection.orgId)?.role ?? "") && (
                    <div className="flex gap-2">
                      <input aria-label="Teacher email" className={`${input} flex-1`} placeholder="Add teacher by email" value={email} onChange={(e) => setEmail(e.target.value)} />
                      <button type="button" className="rounded-md border border-zinc-300 px-2 dark:border-zinc-700" disabled={!email.includes("@")}
                        onClick={() => run(async () => { await s.addTeacher(email, "teacher"); setMsg(`${email} can now scan and grade.`); setEmail(""); })}>Add</button>
                    </div>
                  )}
                  {msg && <p className="text-xs text-emerald-700">{msg}</p>}
                  {localTemplate && (
                    <button type="button" className="w-full rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500"
                      onClick={() => run(() => s.createExam(localTemplate.title, localTemplate))}>
                      Create cloud exam from “{localTemplate.title}”
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
