"use client";
/**
 * Teacher Dashboard: greeting, four quick actions, Recent Examinations and At a Glance. Every
 * number comes from this device (saved sheet + IndexedDB scans) or the workspace's real queries;
 * unknown values show "–" and an empty account gets an empty state, never sample rows.
 */
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BrandMark } from "@/components/brand/Brand";
import { useCloudSession } from "@/components/cloud/CloudSession";
import { Icon } from "@/components/shell/Rail";
import { TEMPLATE_CHANGED_EVENT } from "@/lib/active-exam";
import { atAGlance, dashboardRows, firstName, greeting, type DashboardRow, type GlanceTile, type LocalSheet, type WorkspaceExam } from "@/lib/dashboard";
import { isAdmin } from "@/lib/roles/policy";
import { countScans, listScans } from "@/lib/storage/scan-store";
import { readStoredTemplate } from "@/lib/storage/template-store";

const ACTIONS = [
  { id: "design", label: "Design Exam", text: "Set up an answer sheet and print it.", href: "/designer", primary: true },
  { id: "scan", label: "Scan Sheets", text: "Photograph or upload completed sheets.", href: "/scan", primary: false },
  { id: "grade", label: "Grade Exam", text: "Review scores, answer keys and results.", href: "/grade", primary: false },
  { id: "reports", label: "Reports", text: "Item analysis and course outcomes.", href: "/grade?tab=analysis", primary: false },
] as const;

const fmtDate = (t: number | null) => (t === null ? "–" : new Date(t).toLocaleDateString(undefined, { dateStyle: "medium" }));
const num = (n: number | null) => (n === null ? "–" : String(n));

/** The sheet saved on this device, kept current when the designer changes it. */
function useDeviceSheet() {
  const [local, setLocal] = useState<LocalSheet | null>(null);
  const [layoutScans, setLayoutScans] = useState<number | null>(null);
  const [totalScans, setTotalScans] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      const t = readStoredTemplate();
      setLocal(t ? { title: t.title, layoutHash: t.layoutHash, templateId: t.templateId } : null);
      if (t) listScans(t.layoutHash).then((x) => live && setLayoutScans(x.length)).catch(() => live && setLayoutScans(null));
      else setLayoutScans(0);
      countScans().then((n) => live && setTotalScans(n)).catch(() => live && setTotalScans(null));
    };
    read();
    window.addEventListener(TEMPLATE_CHANGED_EVENT, read);
    return () => { live = false; window.removeEventListener(TEMPLATE_CHANGED_EVENT, read); };
  }, []);
  return { local, layoutScans, totalScans };
}

function DashboardView({ name, rows, glance, onOpen }: { name: string | null; rows: DashboardRow[]; glance: GlanceTile[]; onOpen: (r: DashboardRow) => void }) {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); }, []);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6" data-testid="dashboard">
      <header>
        <h1 className="text-2xl font-bold" data-testid="dashboard-greeting">{hour === null ? "Welcome" : greeting(hour)}{name ? `, ${name}` : ""}</h1>
        <p className="mt-2 text-sm text-zinc-500">Design an exam, scan the sheets and grade them, all in one place.</p>
      </header>

      <section aria-label="Quick actions" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="quick-actions">
        {ACTIONS.map((a) => (
          <Link key={a.id} href={a.href} data-testid={`action-${a.id}`}
            className={`group flex flex-col gap-4 rounded-2xl p-6 transition duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${a.primary ? "v-tile-primary" : "v-tile-glass"}`}>
            <span className={`grid size-10 place-items-center rounded-lg ${a.primary ? "bg-white/15 text-white" : "bg-[var(--brand-tint)] text-[var(--brand)]"}`}><Icon id={a.id} /></span>
            <span>
              <span className="block text-base font-semibold">{a.label}</span>
              <span className={`mt-2 block text-sm ${a.primary ? "text-white/80" : "text-zinc-500"}`}>{a.text}</span>
            </span>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="recent-title" className="v-panel min-w-0 overflow-hidden lg:col-span-2" data-testid="recent-exams">
          <div className="flex items-center gap-4 border-b border-[var(--border)] p-6">
            <h2 id="recent-title" className="text-base font-semibold">Recent Examinations</h2>
            {rows.length > 0 && <Link href="/grade" className="ml-auto text-sm font-medium text-[var(--brand)] hover:underline">Open Gradebook</Link>}
          </div>
          {rows.length === 0 ? (
            <div className="grid justify-items-center gap-4 p-8 text-center" data-testid="recent-empty">
              <BrandMark className="size-12" />
              <div>
                <p className="text-base font-semibold">No examinations yet</p>
                <p className="mt-2 text-sm text-zinc-500">Design your first answer sheet and it will show up here.</p>
              </div>
              <Link href="/designer" className="v-btn v-btn-primary px-4">Design Exam</Link>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="v-table min-w-[560px]">
                <caption className="sr-only">Recent examinations</caption>
                <thead><tr><th scope="col" className="px-6 py-2">Exam</th><th scope="col" className="px-4 py-2">Saved</th><th scope="col" className="px-4 py-2">Status</th><th scope="col" className="px-4 py-2 text-right">Sheets</th><th scope="col" className="px-4 py-2">Created</th><th scope="col" className="px-4 py-2"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} data-testid="recent-row">
                      <td className="px-6 py-4"><span className="block font-medium">{r.name}</span>{r.period && <span className="block text-xs text-zinc-500">{r.period}</span>}</td>
                      <td className="px-4 py-4 text-zinc-500">{r.where}</td>
                      <td className="px-4 py-4"><span className={`v-badge ${r.status === "Open" ? "v-badge-ok" : r.status === "Draft" ? "v-badge-gold" : ""}`}>{r.status}</span></td>
                      <td className="v-mono px-4 py-4 text-right">{num(r.scanned)}</td>
                      <td className="px-4 py-4 text-zinc-500">{fmtDate(r.createdAt)}</td>
                      <td className="px-4 py-4 text-right"><button type="button" className="v-btn !px-4 !py-1" onClick={() => onOpen(r)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="glance-title" className="v-panel p-6" data-testid="at-a-glance">
          <h2 id="glance-title" className="text-base font-semibold">At a Glance</h2>
          <dl className="mt-4 space-y-4">
            {glance.filter((t) => t.available).map((t) => (
              <div key={t.id} className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] pb-4 last:border-0 last:pb-0" data-testid={`glance-${t.id}`}>
                <dt className="text-sm text-zinc-500">{t.label}</dt>
                <dd className="v-mono text-2xl font-bold">{num(t.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-xs text-zinc-500">Counts come from this device and your workspace.</p>
        </section>
      </div>
    </div>
  );
}

/** Convex-backed data: only mounted when a cloud session exists (hooks need the provider). */
function CloudDashboard() {
  const s = useCloudSession()!;
  const router = useRouter();
  const { local, layoutScans, totalScans } = useDeviceSheet();
  const orgId = s.workspace.orgId;
  const member = s.workspace.access === "member" && !!orgId;
  const admin = member && isAdmin(s.workspace.role);
  const examsQ = useQuery(api.exams.listByOrg, member ? { orgId: orgId! } : "skip");
  const syllabiQ = useQuery(api.syllabi.listByOrg, member ? { orgId: orgId! } : "skip");
  const pendingQ = useQuery(api.admin.pendingCount, admin ? { orgId: orgId! } : "skip");
  // not a member (or signed out): the workspace has no exams to show, which is a known empty, not "loading"
  const loading = s.isLoading || (s.isAuthenticated && s.workspace.access === "loading");
  const exams: WorkspaceExam[] | undefined = member ? examsQ : loading ? undefined : [];
  const signedIn = !!s.isAuthenticated && !!s.me;

  const rows = dashboardRows({ local, localScanCount: layoutScans, exams });
  const glance = atAGlance({ exams, local, localScanCount: totalScans, syllabi: member ? (syllabiQ?.length ?? null) : undefined, pending: admin ? (pendingQ ?? null) : undefined });
  return (
    <DashboardView name={signedIn ? firstName(s.me?.name) : null} rows={rows} glance={glance}
      onOpen={(r) => { if (r.examId) s.selectExam(r.examId as Id<"exams">); router.push("/grade"); }} />
  );
}

function LocalDashboard() {
  const router = useRouter();
  const { local, layoutScans, totalScans } = useDeviceSheet();
  return (
    <DashboardView name={null} rows={dashboardRows({ local, localScanCount: layoutScans, exams: [] })}
      glance={atAGlance({ exams: [], local, localScanCount: totalScans })} onOpen={() => router.push("/grade")} />
  );
}

export default function Dashboard() {
  return useCloudSession() ? <CloudDashboard /> : <LocalDashboard />;
}
