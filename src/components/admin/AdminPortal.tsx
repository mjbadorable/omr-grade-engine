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
import { EmptyHero } from "@/components/brand/Brand";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { AUDIT_KINDS, AUDIT_LABEL, type AuditKind } from "@/lib/admin/audit";
import { CLASE_FORMULA, type GradingFormula, labGrade, lectureGrade, termGrade, validateFormula } from "@/lib/admin/formula";
import { isAdmin, type Role } from "@/lib/roles/policy";
import { parseEmailList } from "@/lib/access-requests";
import { adminOverview } from "@/lib/admin/overview";

type Tab = "faculty" | "access" | "syllabi" | "audit" | "policy";
const input = "v-input";
const btn = "v-btn";
const errText = (e: unknown) => (e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? String(e);
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
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
  if (!s.isAuthenticated) return <Notice title="Sign in required">Use the Sign in button at the top right with your @usa.edu.ph Google account.</Notice>;
  const orgId = s.selection.orgId;
  const role = (s.orgs?.find((o) => o._id === orgId)?.role ?? null) as Role | null;
  if (!orgId) return <Notice title="Setting up your workspace">Joining the University of San Agustin workspace…</Notice>;
  if (!isAdmin(role)) return <Notice title="Admins only">This area is for EdTech staff, supervisors and deans. Your role in this workspace is <b>{role ?? "none"}</b>; ask an admin if you need access.</Notice>;
  return <Portal orgId={orgId} myUserId={s.me!._id} role={role!} />;
}

function Portal({ orgId, myUserId, role }: { orgId: Id<"orgs">; myUserId: Id<"users">; role: Role }) {
  const [tab, setTab] = useState<Tab>("faculty");
  const pending = useQuery(api.admin.pendingCount, { orgId });
  const faculty = useQuery(api.admin.listFaculty, { orgId });
  const syllabi = useQuery(api.syllabi.listByOrg, { orgId });
  const exams = useQuery(api.exams.listByOrg, { orgId });
  const tiles = adminOverview({ faculty, pending, syllabi, exams });
  const tabs: [Tab, string][] = [["faculty", "Faculty"], ["access", "Access"], ["syllabi", "Syllabi"], ["audit", "Audit Trail"], ["policy", "Policy & Grading"]];
  return (
    <div className="flex flex-col">
      <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-4" data-testid="admin-overview">
        {tiles.map((t) => (
          <div key={t.id} className={`v-panel px-3 py-2 ${t.warn ? "!border-gold bg-gold-tint" : ""}`} data-testid={`overview-${t.id}`}>
            <dt className="text-xs font-medium text-zinc-500">{t.label}</dt>
            <dd className="text-xl font-bold tabular-nums">{t.value ?? "–"}</dd>
          </div>
        ))}
      </dl>
      <div role="toolbar" aria-label="Admin sections" data-testid="page-toolbar" className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm">
        <div className="v-tabs max-w-full overflow-x-auto" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
              className="v-tab inline-flex items-center gap-1.5">{label}{t === "access" && !!pending && <span className="v-badge v-badge-gold !text-[11px]" data-testid="access-pending-badge" title={`${pending} pending request${pending > 1 ? "s" : ""}`}>{pending}</span>}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-500">Signed in as {role}</span>
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">
        {tab === "faculty" && <Faculty orgId={orgId} myUserId={myUserId} />}
        {tab === "access" && <Access orgId={orgId} />}
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
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => (rows ?? []).filter((r) => `${r.name} ${r.email} ${r.role}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const run = (f: () => Promise<unknown>) => { setErr(null); f().catch((e) => setErr(errText(e))); };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input name="search-faculty" aria-label="Search faculty" className={`${input} w-64`} placeholder="Search name, email or role" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="ml-auto text-xs text-zinc-500">Add or approve faculty in the <b>Access</b> tab.</p>
      </div>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <div className="v-panel overflow-x-auto">
        <table className="v-table">
          <thead><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2 text-right">Access</th></tr></thead>
          <tbody>
            {rows === undefined && <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>}
            {shown.map((r) => {
              const locked = r.role === "owner" || r.userId === myUserId;
              return (
                <tr key={r.userId} data-testid={`faculty-${r.email}`}>
                  <td className="px-3 py-2">{r.name || "—"}{r.userId === myUserId && <span className="ml-1 text-xs text-zinc-400">(you)</span>}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.email}</td>
                  <td className="px-3 py-2"><span className={`v-badge ${r.role === "admin" || r.role === "owner" ? "v-badge-brand" : ""}`}>{r.role}</span></td>
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
      <p className="text-xs text-zinc-500">Teachers drop syllabi, build exams, scan and grade. Admins also manage roles, policy and the audit trail. Faculty become members by pre-authorization or by approving their access request.</p>
    </section>
  );
}

// ------------------------------------------------------------------ access
function Access({ orgId }: { orgId: Id<"orgs"> }) {
  const data = useQuery(api.admin.listAccess, { orgId });
  const preAuthorize = useMutation(api.admin.preAuthorize);
  const revoke = useMutation(api.admin.revokePreAuthorization);
  const decide = useMutation(api.admin.decideRequest);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"teacher" | "admin">("teacher");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [grant, setGrant] = useState<Record<string, "teacher" | "admin">>({});
  const preview = parseEmailList(emails);
  const run = (f: () => Promise<unknown>) => { setErr(null); f().catch((e) => setErr(errText(e))); };
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3" data-testid="pending-requests">
        <h2 className="text-base font-semibold">Pending requests {data ? <span className="v-badge v-badge-gold ml-1">{data.pending.length}</span> : null}</h2>
        <p className="text-xs text-zinc-500">People signed in with an @usa.edu.ph account who asked for faculty access. Students share the domain, so approve only faculty.</p>
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        <ul className="v-panel divide-y divide-[var(--border)] overflow-hidden">
          {data === undefined && <li className="px-3 py-6 text-center text-sm text-zinc-500">Loading…</li>}
          {data && !data.pending.length && <li className="px-3 py-6 text-center text-sm text-zinc-500">No pending requests.</li>}
          {data?.pending.map((r) => (
            <li key={r._id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid={`request-${r.email}`}>
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name || r.email}</p><p className="truncate text-xs text-zinc-500">{r.email} · {when(r.requestedAt)}</p></div>
              <select name={`role-${r._id}`} aria-label={`Role for ${r.email}`} className={input} value={grant[r._id] ?? "teacher"} onChange={(e) => setGrant((g) => ({ ...g, [r._id]: e.target.value as "teacher" | "admin" }))}>
                <option value="teacher">Teacher</option><option value="admin">Admin</option>
              </select>
              <button type="button" className="v-btn v-btn-primary !px-3 !py-1 !text-xs" onClick={() => run(() => decide({ orgId, requestId: r._id, decision: "approve", role: grant[r._id] ?? "teacher" }))}>Approve</button>
              <button type="button" className={btn} onClick={() => run(() => decide({ orgId, requestId: r._id, decision: "reject" }))}>Reject</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Pre-authorize faculty</h2>
        <p className="text-xs text-zinc-500">Paste @usa.edu.ph emails separated by commas or new lines. They are bound to the chosen role the moment they sign in.</p>
        <textarea name="faculty-emails" aria-label="Faculty emails" className={`${input} h-28 w-full font-mono text-xs`} placeholder={"ana@usa.edu.ph\nben@usa.edu.ph, carla@usa.edu.ph"} value={emails} onChange={(e) => setEmails(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <select name="role-to-grant" aria-label="Role to grant" className={input} value={role} onChange={(e) => setRole(e.target.value as "teacher" | "admin")}><option value="teacher">Teacher</option><option value="admin">Admin</option></select>
          <button type="button" className="v-btn v-btn-primary px-4" disabled={!preview.valid.length && !preview.invalid.length}
            onClick={() => { setMsg(null); setErr(null); preAuthorize({ orgId, emails, role }).then((r) => { setMsg({ ok: r.invalid.length === 0, text: [r.queued.length && `${r.queued.length} will be bound at first sign-in`, r.bound.length && `${r.bound.length} already signed in: bound now`, r.unchanged.length && `${r.unchanged.length} already had access`, r.invalid.length && `Not accepted: ${r.invalid.join(", ")}`].filter(Boolean).join(" · ") }); if (!r.invalid.length) setEmails(""); }).catch((e) => setErr(errText(e))); }}>
            Authorize {preview.valid.length || ""} {preview.valid.length === 1 ? "person" : "people"}
          </button>
        </div>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`} data-testid="preauth-result">{msg.text}</p>}
        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Waiting for first sign-in ({data?.preAuthorized.length ?? 0})</h3>
        <ul className="v-panel divide-y divide-[var(--border)] overflow-hidden">
          {data && !data.preAuthorized.length && <li className="px-3 py-4 text-center text-sm text-zinc-500">None.</li>}
          {data?.preAuthorized.map((p) => (
            <li key={p._id} className="flex items-center gap-2 px-3 py-1.5 text-sm"><span className="min-w-0 flex-1 truncate">{p.email}</span><span className="v-badge">{p.role}</span>
              <button type="button" className="text-xs text-red-600 underline" onClick={() => run(() => revoke({ orgId, id: p._id }))}>Revoke</button></li>
          ))}
        </ul>
      </div>
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
      <input name="search-syllabi" aria-label="Search syllabi" className={`${input} w-72`} placeholder="Search course, term or uploader" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <div className="v-panel overflow-x-auto">
        <table className="v-table">
          <thead><tr><th className="px-3 py-2">Course</th><th className="px-3 py-2">Term</th><th className="px-3 py-2">PO / CO / Modules</th><th className="px-3 py-2">Uploaded by</th><th className="px-3 py-2">Updated</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {rows === undefined && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>}
            {rows && !shown.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">{rows.length ? "No match." : "No syllabi yet. Faculty add them by dropping a PDF in the designer."}</td></tr>}
            {shown.map((r) => (
              <tr key={r._id}>
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
        <input name="search-audit" aria-label="Search audit trail" type="search" className={`${input} w-72`} placeholder="Search person, exam, question, reason…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {AUDIT_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => toggle(k)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${kinds.includes(k) ? "border-[var(--brand)] bg-[var(--brand-tint)] text-[var(--brand-text-on-tint)]" : "border-[var(--border)] text-zinc-600 hover:border-[var(--brand-soft)] dark:text-zinc-400"}`}>{AUDIT_LABEL[k]}</button>
          ))}
        </div>
        {res && <span className="ml-auto text-xs text-zinc-500">{res.rows.length} of {res.total}</span>}
      </div>
      <div className="v-panel overflow-x-auto">
        <table className="v-table">
          <thead><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Exam</th><th className="px-3 py-2">What</th></tr></thead>
          <tbody>
            {res === undefined && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Loading…</td></tr>}
            {res && !res.rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Nothing matches.</td></tr>}
            {res?.rows.map((r) => (
              <tr key={r.id} className="align-top">
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
    <input id={`policy-${k}`} name={`policy-${k}`} type="number" min={0} max={100} className={`${input} w-20`} value={f[k]} onChange={(e) => setF((cur) => ({ ...cur, [k]: Number(e.target.value), ...(k === "lectureWeight" ? { labWeight: 100 - Number(e.target.value) } : k === "labWeight" ? { lectureWeight: 100 - Number(e.target.value) } : {}) }))} />
  );
  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Global grading formula</h2>
        <p className="text-xs text-zinc-500">Default is the USA CLASE standard. Term Grade = {f.lectureWeight}% Lecture + {f.labWeight}% Lab.</p>
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
          <label htmlFor="policy-lectureWeight">Lecture weight (% of term grade)</label>{num("lectureWeight")}
          <label htmlFor="policy-labWeight">Lab weight (% of term grade)</label>{num("labWeight")}
          <label htmlFor="policy-lectureMajorExamWeight">Major exam (% of lecture grade)</label>{num("lectureMajorExamWeight")}
          <label htmlFor="policy-labExamWeight">Lab exam (% of lab grade)</label>{num("labExamWeight")}
        </div>
        <p className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Example: major exam 80, class standing 100 → lecture {lectureGrade(80, 100, f)}; lab exam 100, activities 50 → lab {labGrade(100, 50, f)}; term grade {termGrade(lectureGrade(80, 100, f), labGrade(100, 50, f), f)}.
        </p>
        {errors.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}
      </div>
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Domain allowlist policy</h2>
        <p className="text-xs text-zinc-500">Only people at these domains can be added to this school. Leave empty to rely on the deployment-wide sign-in allowlist (<code>@usa.edu.ph</code>). Subdomains are not matched.</p>
        <input name="allowed-domains" aria-label="Allowed domains" className={`${input} w-full`} placeholder="usa.edu.ph, faculty.usa.edu.ph" value={domains} onChange={(e) => setDomains(e.target.value)} />
      </div>
      <div className="md:col-span-2">
        <button type="button" className="v-btn v-btn-primary px-4" disabled={errors.length > 0}
          onClick={() => { setMsg(null); save({ orgId, gradingFormula: f, allowedDomains: domains.split(/[\s,;]+/).filter(Boolean) }).then(() => setMsg({ ok: true, text: "Policy saved." })).catch((e) => setMsg({ ok: false, text: errText(e) })); }}>Save policy</button>
        {msg && <span role="status" className={`ml-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
