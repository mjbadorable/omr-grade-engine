"use client";
/**
 * Governance portal. The page itself is public HTML; every piece of data comes from Convex
 * functions that check the caller's role server-side, so hiding the UI from non-admins here is a
 * courtesy, not the security boundary.
 */
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import AppNav from "@/components/AppNav";
import Brand, { EmptyHero } from "@/components/brand/Brand";
import CloudBar from "@/components/cloud/CloudBar";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { AUDIT_KINDS, AUDIT_LABEL, type AuditKind } from "@/lib/admin/audit";
import { CLASE_FORMULA, type GradingFormula, labGrade, lectureGrade, termGrade, validateFormula } from "@/lib/admin/formula";
import { isAdmin, type Role } from "@/lib/roles/policy";

type Tab = "faculty" | "syllabi" | "audit" | "policy";
const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const btn = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900";
const errText = (e: unknown) => (e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? String(e);
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Header() {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
      <Brand page="Admin" />
      <AppNav />
      <div className="ml-auto"><CloudBar /></div>
    </header>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="mx-auto mt-16 max-w-md px-4 text-center" data-testid="admin-notice">
        <EmptyHero title={title}>{children}</EmptyHero>
      </main>
    </div>
  );
}

export default function AdminPortal() {
  const s = useCloudSession();
  if (!s) return <Notice title="Cloud backend not configured">The admin portal manages the school&apos;s shared cloud workspace. Set <code>NEXT_PUBLIC_CONVEX_URL</code> to enable it.</Notice>;
  if (s.isLoading || (s.isAuthenticated && s.orgs === undefined)) return <Notice title="Loading…">Checking your access.</Notice>;
  if (!s.isAuthenticated) return <Notice title="Sign in required">Use the Cloud button above to sign in with your institutional Google account.</Notice>;
  const orgId = s.selection.orgId;
  const role = (s.orgs?.find((o) => o._id === orgId)?.role ?? null) as Role | null;
  if (!orgId) return <Notice title="Choose a school">Pick your school from the Cloud menu above.</Notice>;
  if (!isAdmin(role)) return <Notice title="Admins only">This area is for EdTech staff, supervisors and deans. Your role in this school is <b>{role ?? "none"}</b>; ask an admin if you need access.</Notice>;
  return <Portal orgId={orgId} myUserId={s.me!._id} role={role!} />;
}

function Portal({ orgId, myUserId, role }: { orgId: Id<"orgs">; myUserId: Id<"users">; role: Role }) {
  const [tab, setTab] = useState<Tab>("faculty");
  const tabs: [Tab, string][] = [["faculty", "Faculty"], ["syllabi", "Syllabi"], ["audit", "Audit trail"], ["policy", "Policy & grading"]];
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <div className="flex gap-1" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 ${tab === t ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>{label}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-500">Signed in as {role}</span>
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">
        {tab === "faculty" && <Faculty orgId={orgId} myUserId={myUserId} />}
        {tab === "syllabi" && <Syllabi orgId={orgId} />}
        {tab === "audit" && <Audit orgId={orgId} />}
        {tab === "policy" && <Policy orgId={orgId} />}
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ faculty
function Faculty({ orgId, myUserId }: { orgId: Id<"orgs">; myUserId: Id<"users"> }) {
  const rows = useQuery(api.admin.listFaculty, { orgId });
  const setRole = useMutation(api.admin.setRole);
  const addMember = useMutation(api.orgs.addMember);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [q, setQ] = useState("");
  const shown = useMemo(() => (rows ?? []).filter((r) => `${r.name} ${r.email} ${r.role}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const run = (f: () => Promise<unknown>) => { setErr(null); f().catch((e) => setErr(errText(e))); };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search faculty" className={`${input} w-64`} placeholder="Search name, email or role" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ml-auto flex gap-2">
          <input aria-label="Faculty email" className={`${input} w-64`} placeholder="Add faculty by @usa.edu.ph email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" className={btn} disabled={!email.includes("@")} onClick={() => run(async () => { await addMember({ orgId, email, role: "teacher" }); setEmail(""); })}>Add as teacher</button>
        </div>
      </div>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2 text-right">Access</th></tr></thead>
          <tbody>
            {rows === undefined && <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>}
            {shown.map((r) => {
              const locked = r.role === "owner" || r.userId === myUserId;
              return (
                <tr key={r.userId} className="border-t border-zinc-100 dark:border-zinc-800" data-testid={`faculty-${r.email}`}>
                  <td className="px-3 py-2">{r.name || "—"}{r.userId === myUserId && <span className="ml-1 text-xs text-zinc-400">(you)</span>}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.email}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.role === "admin" || r.role === "owner" ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200" : "bg-zinc-100 dark:bg-zinc-800"}`}>{r.role}</span></td>
                  <td className="px-3 py-2 text-right">
                    {locked ? <span className="text-xs text-zinc-400">{r.role === "owner" ? "School owner" : "Cannot change your own role"}</span> : (
                      <span className="inline-flex gap-2">
                        {r.role === "teacher" && <button type="button" className={btn} onClick={() => run(() => setRole({ orgId, userId: r.userId, role: "admin" }))}>Elevate to admin</button>}
                        {r.role === "admin" && <button type="button" className={btn} onClick={() => run(() => setRole({ orgId, userId: r.userId, role: "teacher" }))}>Make teacher</button>}
                        {r.role === "viewer" && <button type="button" className={btn} onClick={() => run(() => setRole({ orgId, userId: r.userId, role: "teacher" }))}>Make teacher</button>}
                        {r.role !== "viewer" && <button type="button" className={btn} onClick={() => run(() => setRole({ orgId, userId: r.userId, role: "viewer" }))}>Read-only</button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">Teachers drop syllabi, build exams, scan and grade. Admins also manage roles, policy and the audit trail. New faculty must sign in once with their institutional account before they can be added.</p>
    </section>
  );
}

// ------------------------------------------------------------------ syllabi
function Syllabi({ orgId }: { orgId: Id<"orgs"> }) {
  const rows = useQuery(api.syllabi.listByOrg, { orgId });
  const remove = useMutation(api.syllabi.remove);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const shown = (rows ?? []).filter((r) => `${r.courseCode} ${r.courseTitle} ${r.term} ${r.uploadedBy}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="space-y-3">
      <input aria-label="Search syllabi" className={`${input} w-72`} placeholder="Search course, term or uploader" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2">Course</th><th className="px-3 py-2">Term</th><th className="px-3 py-2">PO / CO / Modules</th><th className="px-3 py-2">Uploaded by</th><th className="px-3 py-2">Updated</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {rows === undefined && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>}
            {rows && !shown.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">{rows.length ? "No match." : "No syllabi yet. Faculty add them by dropping a PDF in the designer."}</td></tr>}
            {shown.map((r) => (
              <tr key={r._id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2"><b>{r.courseCode}</b> {r.courseTitle}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.term || "—"}</td>
                <td className="px-3 py-2 tabular-nums">{r.poCount} / {r.coCount} / {r.moduleCount}</td>
                <td className="px-3 py-2">{r.uploadedBy}</td>
                <td className="px-3 py-2 text-zinc-500">{when(r.updatedAt)}</td>
                <td className="px-3 py-2 text-right"><button type="button" className="text-xs text-red-600 underline" onClick={() => { if (confirm(`Remove ${r.courseCode} (${r.term || "no term"})?`)) { setErr(null); remove({ syllabusId: r._id }).catch((e) => setErr(errText(e))); } }}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ audit
function Audit({ orgId }: { orgId: Id<"orgs"> }) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kinds, setKinds] = useState<AuditKind[]>([]);
  useEffect(() => { const h = setTimeout(() => setDebounced(text), 250); return () => clearTimeout(h); }, [text]);
  const res = useQuery(api.admin.auditTrail, { orgId, query: debounced || undefined, kinds: kinds.length ? kinds : undefined, limit: 200 });
  const toggle = (k: AuditKind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search audit trail" type="search" className={`${input} w-72`} placeholder="Search person, exam, question, reason…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {AUDIT_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => toggle(k)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${kinds.includes(k) ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}>{AUDIT_LABEL[k]}</button>
          ))}
        </div>
        {res && <span className="ml-auto text-xs text-zinc-500">{res.rows.length} of {res.total}</span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Exam</th><th className="px-3 py-2">What</th></tr></thead>
          <tbody>
            {res === undefined && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>}
            {res && !res.rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Nothing matches.</td></tr>}
            {res?.rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{when(r.at)}</td>
                <td className="px-3 py-2">{r.actorName}<div className="text-xs text-zinc-400">{r.actorEmail}</div></td>
                <td className="whitespace-nowrap px-3 py-2">{r.label}</td>
                <td className="px-3 py-2">{r.examName ?? "—"}</td>
                <td className="px-3 py-2">{r.summary}{r.detail && <div className="text-xs text-zinc-500">{r.detail}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ policy
function Policy({ orgId }: { orgId: Id<"orgs"> }) {
  const policy = useQuery(api.admin.getPolicy, { orgId });
  const save = useMutation(api.admin.setPolicy);
  const [f, setF] = useState<GradingFormula>(CLASE_FORMULA);
  const [domains, setDomains] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (policy) { setF(policy.gradingFormula); setDomains(policy.allowedDomains.join(", ")); } }, [policy]);
  const errors = validateFormula(f);
  const num = (k: keyof GradingFormula) => (
    <input type="number" min={0} max={100} className={`${input} w-20`} value={f[k]} onChange={(e) => setF((cur) => ({ ...cur, [k]: Number(e.target.value), ...(k === "lectureWeight" ? { labWeight: 100 - Number(e.target.value) } : k === "labWeight" ? { lectureWeight: 100 - Number(e.target.value) } : {}) }))} />
  );
  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Global grading formula</h2>
        <p className="text-xs text-zinc-500">Default is the USA CLASE standard. Term Grade = {f.lectureWeight}% Lecture + {f.labWeight}% Lab.</p>
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
          <label>Lecture weight (% of term grade)</label>{num("lectureWeight")}
          <label>Lab weight (% of term grade)</label>{num("labWeight")}
          <label>Major exam (% of lecture grade)</label>{num("lectureMajorExamWeight")}
          <label>Lab exam (% of lab grade)</label>{num("labExamWeight")}
        </div>
        <p className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Example: major exam 80, class standing 100 → lecture {lectureGrade(80, 100, f)}; lab exam 100, activities 50 → lab {labGrade(100, 50, f)}; term grade {termGrade(lectureGrade(80, 100, f), labGrade(100, 50, f), f)}.
        </p>
        {errors.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}
      </div>
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Domain allowlist policy</h2>
        <p className="text-xs text-zinc-500">Only people at these domains can be added to this school. Leave empty to rely on the deployment-wide sign-in allowlist (<code>@usa.edu.ph</code>). Subdomains are not matched.</p>
        <input aria-label="Allowed domains" className={`${input} w-full`} placeholder="usa.edu.ph, faculty.usa.edu.ph" value={domains} onChange={(e) => setDomains(e.target.value)} />
      </div>
      <div className="md:col-span-2">
        <button type="button" className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40" disabled={errors.length > 0}
          onClick={() => { setMsg(null); save({ orgId, gradingFormula: f, allowedDomains: domains.split(/[\s,;]+/).filter(Boolean) }).then(() => setMsg({ ok: true, text: "Policy saved." })).catch((e) => setMsg({ ok: false, text: errText(e) })); }}>Save policy</button>
        {msg && <span role="status" className={`ml-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
