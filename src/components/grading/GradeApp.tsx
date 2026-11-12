"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import AppNav from "@/components/AppNav";
import Brand, { EmptyHero } from "@/components/brand/Brand";
import CloudBar from "@/components/cloud/CloudBar";
import { useCloudExam } from "@/components/cloud/CloudExam";
import { answerKeyToBody } from "@/lib/cloud/convert";
import { renderScorecards } from "@/lib/export/scorecard-client";
import type { ScorecardInput } from "@/lib/export/scorecard-generator";
import { computeClassStanding } from "@/lib/export/standing";
import { keyFromScannedAnswers, keyFromTemplate, parseKey, serializeKey, updateKey } from "@/lib/grading/answer-key";
import { gradebookRows, toCsv, toWorkbook } from "@/lib/grading/export";
import { analyzeItems } from "@/lib/grading/item-analysis";
import { rescoreBatch } from "@/lib/grading/scorer";
import { mulberry32, simulateClass } from "@/lib/grading/simulate";
import type { AnswerKey, ChoiceRule, ScanInput, ScoredSheet } from "@/lib/grading/types";
import { type OMRTemplate, OMRTemplateSchema } from "@/lib/omr/schema";
import { applyOverrides, type ManualOverridePatch } from "@/lib/review/overrides";
import { reconcile } from "@/lib/roster/reconcile";
import type { Roster } from "@/lib/roster/schema";
import { studentName } from "@/lib/samples/names";
import { clearScans, getMeta, listOverrides, listResolutions, listScans, putOverride, putResolution, setMeta, type StoredScan } from "@/lib/storage/scan-store";
import { readStoredKey, readStoredTemplate, writeStoredKey, writeStoredTemplate } from "@/lib/storage/template-store";
import { computeAttainment } from "@/lib/syllabus/attainment";
import { readStoredPlan, type SyllabusPlan } from "@/lib/syllabus/plan-store";
import { applyOutcomesToKey, hasOutcomes } from "@/lib/syllabus/tos";
import { PERIOD_LABEL, type Syllabus } from "@/lib/syllabus/types";
import { type ConflictGroup, detectConflicts, sheetDisposition, type SyncedSheet } from "@/lib/sync/conflicts";
import { identity, localOutbox, makeEngine, recordKey, recordOverride, recordResolution, recordRoster, rosterMetaKey, setSyncEndpoint, setTeacherId, syncEndpoint } from "@/lib/sync/local-sync";
import type { ConflictResolution } from "@/lib/sync/types";
import type { DecodedFields } from "@/lib/vision/types";
import ConflictPanel from "./ConflictPanel";
import Gradebook from "./Gradebook";
import ItemAnalysisView from "./ItemAnalysisView";
import KeyEditor from "./KeyEditor";
import OutcomesView from "./OutcomesView";
import ReviewModal from "./review-modal";
import RosterPanel from "./RosterPanel";
import SyncPanel from "./SyncPanel";

type Tab = "key" | "gradebook" | "roster" | "analysis" | "outcomes";
const btn = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
const outline = `${btn} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`;
const INSTITUTE_KEY = "omr:institute";

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A sheet as the gradebook sees it: raw scanner fields + provenance. Demo sheets have no StoredScan. */
interface SheetSource { sheetId: string; layoutHash: string; deviceId: string; teacherId: string; createdAt: number; raw: DecodedFields; stored: StoredScan | null }

export default function GradeApp() {
  const [template, setTemplate] = useState<OMRTemplate | null>(null);
  const [key, setKey] = useState<AnswerKey | null>(null);
  const [stored, setStored] = useState<StoredScan[]>([]);
  const [demo, setDemo] = useState<SheetSource[]>([]);
  const [localPatches, setPatches] = useState<ManualOverridePatch[]>([]);
  const [localResolutions, setResolutions] = useState<ConflictResolution[]>([]);
  const [localRoster, setRoster] = useState<Roster | null>(null);
  const [cloudDetail, setCloudDetail] = useState<Map<string, StoredScan>>(new Map());
  const [tab, setTab] = useState<Tab>("key");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [who, setWho] = useState({ teacherId: "teacher", endpoint: "" });
  const [institute, setInstitute] = useState("");
  const [plan, setPlan] = useState<SyllabusPlan | null>(null);
  const [exportingObe, setExportingObe] = useState(false);

  // ---- cloud (Convex) mode: the selected exam's live data replaces the local stores
  const cloud = useCloudExam();
  const cloudExamId = cloud?.examId ?? null;
  const patches = cloud ? cloud.patches : localPatches;
  const resolutions = cloud ? cloud.resolutions : localResolutions;
  const roster = cloud ? cloud.roster ?? null : localRoster;

  const refreshPending = useCallback(() => { localOutbox().pending().then((p) => setPending(p.length)).catch(() => {}); }, []);

  const load = useCallback(async (t: OMRTemplate) => {
    setTemplate(t);
    let k = readStoredKey(t.layoutHash) ?? keyFromTemplate(t);
    // Zero-burden OBE: a syllabus dropped in the designer for this very sheet tags the key with outcomes.
    const p = readStoredPlan();
    setPlan(p && p.templateId === t.templateId ? p : null);
    if (p && p.templateId === t.templateId && !hasOutcomes(k) && p.tos.totalQuestions === k.questions.size) k = applyOutcomesToKey(k, p.assignments);
    setKey(k);
    const [scans, ov, res, ro] = await Promise.all([
      listScans(t.layoutHash).catch(() => []), listOverrides().catch(() => []), listResolutions(t.layoutHash).catch(() => []), getMeta<Roster>(rosterMetaKey(t.layoutHash)).catch(() => null),
    ]);
    setStored(scans); setPatches(ov); setResolutions(res); setRoster(ro);
  }, []);

  useEffect(() => {
    setWho({ teacherId: identity().teacherId, endpoint: syncEndpoint() });
    try { setInstitute(localStorage.getItem(INSTITUTE_KEY) ?? ""); } catch { /* ignore */ }
    refreshPending();
  }, [refreshPending]);
  useEffect(() => {
    if (cloudExamId) return;               // cloud exam selected: its template/key come from Convex
    const t = readStoredTemplate();
    if (t) load(t);
  }, [load, cloudExamId]);
  const cloudTemplate = cloud?.template ?? null;
  useEffect(() => { if (cloudTemplate) { setTemplate(cloudTemplate); setDemo([]); } }, [cloudTemplate]);

  // ---- cloud key: adopt server versions; push local edits as new versions (optimistic concurrency)
  const dirty = useRef(false);
  const cloudBase = useRef<number | null>(null);
  const [cloudSaving, setCloudSaving] = useState(false);
  const cloudKey = cloud?.key;
  useEffect(() => {
    if (!cloudKey) { cloudBase.current = null; return; }
    if (dirty.current && cloudBase.current !== null && cloudKey.version === cloudBase.current) return; // own edits pending
    if (dirty.current && cloudBase.current !== null && cloudKey.version !== cloudBase.current) {
      setNotice(`Another teacher saved answer key v${cloudKey.version}; it replaced your unsaved edits.`);
    }
    dirty.current = false;
    cloudBase.current = cloudKey.version;
    setKey(cloudKey);
  }, [cloudKey]);
  const editKey = useCallback((k: AnswerKey | ((cur: AnswerKey | null) => AnswerKey | null)) => {
    dirty.current = true;
    setKey(k as AnswerKey);
  }, []);
  useEffect(() => {
    if (!cloud || !key || !dirty.current || cloudBase.current === null) return;
    const h = setTimeout(async () => {
      if (!dirty.current || !cloud.key) return;
      if (JSON.stringify(answerKeyToBody(key)) === JSON.stringify(answerKeyToBody(cloud.key))) { dirty.current = false; return; }
      setCloudSaving(true);
      try {
        const r = await cloud.saveKey(key, cloudBase.current!);
        if (r.ok) { cloudBase.current = r.version; if (r.queued) setNotice("Saved offline. The answer key will sync automatically when you are back online."); }
        else setNotice(`Answer key v${r.currentVersion} was saved by another teacher; your edits were not applied. Re-apply them on the new version.`);
        dirty.current = false;
      } catch (e) {
        setNotice(`Could not save the answer key: ${e instanceof Error ? e.message : e}`);
      } finally {
        setCloudSaving(false);
      }
    }, 700);
    return () => clearTimeout(h);
  }, [key, cloud]);

  // ---- persist + queue key versions (debounced so typing does not flood the outbox)
  const lastQueued = useRef(0);
  useEffect(() => {
    if (!key || !template || cloudExamId) return;
    writeStoredKey(template.layoutHash, key);
    if (key.version === lastQueued.current) return;
    const h = setTimeout(() => { lastQueued.current = key.version; recordKey({ ...key, layoutHash: template.layoutHash }).then(refreshPending).catch(() => {}); }, 800);
    return () => clearTimeout(h);
  }, [key, template, refreshPending, cloudExamId]);

  // ---- sources → effective fields → conflicts → scoring (all memoised, key deferred)
  const cloudScans = cloud?.scans;
  const sources = useMemo<SheetSource[]>(() => cloud
    ? (cloudScans ?? []).map((s) => ({ sheetId: s._id, layoutHash: cloud.template.layoutHash, deviceId: s.deviceId, teacherId: s.scannedByTeacherId, createdAt: s.scanTimestamp, raw: s.fields, stored: null }))
    : [
      ...stored.map((s) => ({ sheetId: s.sheetId, layoutHash: s.layoutHash, deviceId: s.deviceId ?? "local", teacherId: s.teacherId ?? "teacher", createdAt: s.createdAt, raw: s.result.fields, stored: s })),
      ...demo,
    ], [cloud, cloudScans, stored, demo]);
  const patchesBySheet = useMemo(() => {
    const m = new Map<string, ManualOverridePatch[]>();
    for (const p of patches) (m.get(p.sheetId) ?? m.set(p.sheetId, []).get(p.sheetId)!).push(p);
    return m;
  }, [patches]);
  const effective = useMemo(() => sources.map((s) => ({ ...s, fields: applyOverrides(s.raw, patchesBySheet.get(s.sheetId) ?? []) })), [sources, patchesBySheet]);
  const groups = useMemo(() => detectConflicts(effective as SyncedSheet[], resolutions), [effective, resolutions]);
  const disposition = useMemo(() => sheetDisposition(groups), [groups]);
  const counted = useMemo(() => effective.filter((s) => { const d = disposition.get(s.sheetId); return d !== "duplicate" && d !== "superseded"; }), [effective, disposition]);

  const deferredKey = useDeferredValue(key);
  const graded = useMemo(() => {
    if (!deferredKey) return null;
    const t0 = performance.now();
    const inputs: ScanInput[] = counted.map((s) => ({ sheetId: s.sheetId, layoutHash: s.layoutHash, fields: s.fields }));
    const sheets: ScoredSheet[] = rescoreBatch(inputs, deferredKey).map((s) => disposition.get(s.sheetId) === "conflict" ? { ...s, sheetFlags: [...s.sheetFlags, "SYNC_CONFLICT"] } : s);
    const report = analyzeItems(sheets, deferredKey);
    return { sheets, report, ms: performance.now() - t0 };
  }, [counted, deferredKey, disposition]);

  const syllabus: Syllabus | null = (cloud ? cloud.syllabus : plan?.syllabus) ?? null;
  const examPeriod = cloud ? cloud.examPeriod : plan?.period ?? null;
  const attainment = useMemo(() => (graded && deferredKey && hasOutcomes(deferredKey) ? computeAttainment(graded.sheets, deferredKey, syllabus) : null), [graded, deferredKey, syllabus]);

  async function exportAccreditation() {
    if (!graded || !attainment || !template || !key) return;
    setExportingObe(true);
    try {
      const { buildAccreditationReport } = await import("@/lib/syllabus/report");
      const examName = cloud?.name ?? template.title;
      const bytes = await buildAccreditationReport({
        institute: institute || template.pages[0].texts.find((x) => x.id === "p0:subtitle")?.text || "Assessment report",
        examName, period: examPeriod, syllabus, psychometrics: graded.report, attainment, generatedAt: new Date(),
      });
      download(`${syllabus?.courseCode.replace(/\s+/g, "") ?? "exam"}-${examPeriod?.toLowerCase() ?? "report"}-accreditation.pdf`, bytes as BlobPart, "application/pdf");
    } catch (e) {
      setNotice(`Accreditation report failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExportingObe(false);
    }
  }

  const recon = useMemo(() => reconcile(roster, counted.map((s) => ({ sheetId: s.sheetId, rollNumber: s.fields.rollNumber }))), [roster, counted]);
  const names = useMemo(() => new Map([...recon.studentBySheet].map(([id, st]) => [id, st.name])), [recon]);
  const stats = useMemo(() => new Map(graded?.report.items.map((i) => [i.questionNumber, i]) ?? []), [graded]);
  const sourceById = useMemo(() => new Map(effective.map((s) => [s.sheetId, s])), [effective]);

  const keySources = useMemo(() => stored.slice(-20).reverse().map((s) => ({
    id: s.sheetId,
    label: `${s.name} (roll ${s.result.fields.rollNumber ?? "?"})`,
    apply: () => editKey((k) => (k ? keyFromScannedAnswers(k, s.result.fields) : k)),
  })), [stored, editKey]);

  useEffect(() => {
    if (!cloud || !openId || cloudDetail.has(openId)) return;
    let alive = true;
    cloud.loadScanDetail(openId).then((d) => { if (alive && d) setCloudDetail((m) => new Map(m).set(openId, d)); }).catch(() => {});
    return () => { alive = false; };
  }, [cloud, openId, cloudDetail]);

  // ---- mutations
  async function addPatches(ps: ManualOverridePatch[]) {
    if (cloud) { await cloud.addPatches(ps).catch((e) => setNotice(`Correction not saved: ${e?.data?.message ?? e.message}`)); return; }
    setPatches((cur) => [...cur, ...ps]);
    for (const p of ps) {
      await putOverride(p).catch(() => {});
      if (template) await recordOverride(template.layoutHash, p).catch(() => {});
    }
    refreshPending();
  }

  async function importRosterRecord(r: Roster) {
    if (cloud) { await cloud.setRoster(r).catch((e) => setNotice(`Roster not saved: ${e?.data?.message ?? e.message}`)); return; }
    if (!template) return;
    setRoster(r);
    await setMeta(rosterMetaKey(template.layoutHash), r).catch(() => {});
    await recordRoster(template.layoutHash, r).catch(() => {});
    refreshPending();
  }

  async function keep(group: ConflictGroup, keepSheetId: string) {
    if (cloud) { await cloud.resolve(group.rollKey, keepSheetId, group.sheetIds.filter((x) => x !== keepSheetId)).catch((e) => setNotice(`Not saved: ${e?.data?.message ?? e.message}`)); return; }
    const r: ConflictResolution = {
      id: crypto.randomUUID(), layoutHash: group.layoutHash, rollKey: group.rollKey, keepSheetId,
      supersededSheetIds: group.sheetIds.filter((x) => x !== keepSheetId), teacherId: identity().teacherId, timestamp: Date.now(),
    };
    setResolutions((cur) => [...cur, r]);
    await putResolution(r).catch(() => {});
    await recordResolution(r).catch(() => {});
    refreshPending();
  }

  function generateDemo() {
    if (!key) return;
    const rnd = mulberry32(key.version * 7919 + demo.length);
    let k = key;
    const next = new Map(k.questions);
    let changed = false;
    for (const [n, r] of next) if (r.type === "choice" && !r.correct.length) { next.set(n, { ...r, correct: [Math.floor(rnd() * r.optionCount)] }); changed = true; }
    if (changed) k = { ...k, questions: next, version: k.version + 1 };
    const choice = [...k.questions.values()].filter((r): r is ChoiceRule => r.type === "choice" && !r.dropped);
    const trapQ = choice[Math.min(6, choice.length - 1)];
    const traps = trapQ ? { [trapQ.questionNumber]: (trapQ.correct[0] + 1) % trapQ.optionCount } : {};
    const { scans } = simulateClass(k, { students: 200, seed: Math.floor(rnd() * 1e9), traps, uncertainRate: 0.04 });
    const now = Date.now();
    const sheets: SheetSource[] = scans.map((s, i) => ({ sheetId: `demo-${s.sheetId}`, layoutHash: template!.layoutHash, deviceId: "demo-A", teacherId: "Teacher A", createdAt: now + i, raw: s.fields, stored: null }));
    // a second teacher rescans student #5 and reads Q1 differently → cross-device conflict
    const dupe = sheets[4];
    const q1 = dupe.raw.answers[0];
    sheets.push({ ...dupe, sheetId: `${dupe.sheetId}-B`, deviceId: "demo-B", teacherId: "Teacher B", createdAt: now + 999, raw: { ...dupe.raw, answers: [{ ...q1, marked: [(q1.marked[0] ?? 0) + 1 > 3 ? 0 : (q1.marked[0] ?? 0) + 1] }, ...dupe.raw.answers.slice(1)] } });
    // roster: everyone except two "unregistered" students, plus three absentees
    const rosterStudents = scans.filter((_, i) => i !== 10 && i !== 11).map((s, i) => ({ rollNumber: s.fields.rollNumber!, name: studentName(i), section: i % 2 ? "10-A" : "10-B" }));
    for (let a = 0; a < 3; a++) rosterStudents.push({ rollNumber: String(900001 + a), name: studentName(500 + a), section: "10-A" });
    setKey(k);
    setDemo(sheets);
    importRosterRecord({ schema: "omr-roster/v1", name: "Demo class", importedAt: now, students: rosterStudents });
    setNotice(`Demo: 200 simulated students + roster. Q${trapQ?.questionNumber} is miskeyed on purpose, two students are not on the roster, three are absent, and one student was scanned twice by different teachers.`);
    setTab("gradebook");
  }

  async function onTemplateFile(file?: File) {
    if (!file) return;
    const p = OMRTemplateSchema.safeParse(JSON.parse(await file.text()));
    if (!p.success) { setNotice(`Invalid template: ${p.error.issues[0]?.message}`); return; }
    writeStoredTemplate(p.data);
    load(p.data);
  }

  async function onKeyFile(file?: File) {
    if (!file || !key) return;
    try {
      const k = parseKey(JSON.parse(await file.text()));
      editKey({ ...k, version: Math.max(k.version, key.version + 1) });
      setNotice(`Imported answer key "${k.examId}".`);
    } catch (e) {
      setNotice(`Invalid key file: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }

  async function exportXlsx() {
    if (!graded || !key) return;
    const XLSX = await import("xlsx");
    download(`${key.examId}-v${key.version}-results.xlsx`, toWorkbook(XLSX, graded.sheets, key, graded.report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  async function scorecards(only?: string) {
    if (!graded || !template || !key) return;
    setBusy("Building scorecards…");
    try {
      const standing = computeClassStanding(graded.sheets);
      const chosen = only ? graded.sheets.filter((s) => s.sheetId === only) : [...graded.sheets].sort((a, b) => (names.get(a.sheetId) ?? "~").localeCompare(names.get(b.sheetId) ?? "~") || (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));
      const { cropFromPreview, cropRegions } = await import("@/lib/export/crops");
      const regions = cropRegions(template);
      const cards: ScorecardInput[] = [];
      for (const s of chosen) {
        const src = sourceById.get(s.sheetId);
        const st = recon.studentBySheet.get(s.sheetId);
        const crops: ScorecardInput["crops"] = {};
        if (src?.stored?.preview) {
          if (regions.roll) crops.roll = await cropFromPreview(src.stored.preview, src.stored.result, regions.roll).catch(() => undefined);
          if (regions.signature) crops.signature = await cropFromPreview(src.stored.preview, src.stored.result, regions.signature).catch(() => undefined);
        }
        cards.push({
          institute: institute || template.pages[0].texts.find((x) => x.id === "p0:subtitle")?.text || "Assessment report",
          examTitle: template.title, date: new Date().toISOString().slice(0, 10),
          student: { name: st?.name ?? null, rollNumber: st?.rollNumber ?? s.rollNumber, section: st?.section },
          sheet: s, rank: standing.get(s.sheetId)?.rank ?? null, classSize: graded.sheets.length, percentile: standing.get(s.sheetId)?.percentile ?? null,
          crops,
        });
      }
      const bytes = await renderScorecards(cards, `${template.title} scorecards`);
      const file = only ? `scorecard-${chosen[0]?.rollNumber ?? "student"}.pdf` : `${key.examId}-scorecards.pdf`;
      download(file, bytes as BlobPart, "application/pdf");
    } catch (e) {
      setNotice(`Scorecards failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  if (!template || !key) {
    return (
      <div className="min-h-dvh">
        <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950"><Brand page="Gradebook" /><AppNav /><div className="ml-auto"><CloudBar /></div></header>
        <div className="mx-auto max-w-xl p-8 text-center">
          <EmptyHero title="Nothing to grade yet" className="mb-4">{cloud === null && cloudExamId === null ? "Design a sheet first (it is remembered in this browser), load its template-coordinates.json, open a cloud exam, or download the Sample Exam Kit from the designer." : "Loading the cloud exam…"}</EmptyHero>
          <div className="flex justify-center gap-2">
            <Link href="/designer" className={outline}>Open designer</Link>
            <label className={`${outline} cursor-pointer`}>Load template JSON<input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => onTemplateFile(e.target.files?.[0])} /></label>
          </div>
          {notice && <p className="mt-3 text-sm text-red-600">{notice}</p>}
        </div>
      </div>
    );
  }

  const openSheet = openId ? graded?.sheets.find((s) => s.sheetId === openId) ?? null : null;
  const openSource = openId ? sourceById.get(openId) ?? null : null;
  const keyed = [...key.questions.values()].filter((r) => (r.type === "choice" ? r.correct.length : r.type === "numeric" ? r.value !== null : true)).length;
  const openConflicts = groups.filter((g) => g.kind === "DIVERGENT_ANSWERS" && !g.resolution).length;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
        <Brand page="Gradebook" />
        <AppNav />
        <span className="truncate text-sm text-zinc-500">{template.title} · <span className="font-mono text-xs">#{template.layoutHash}</span></span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span data-testid="key-status" className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Every edit creates a new key version and rescores all sheets">
            {cloud ? `cloud key v${cloudBase.current ?? key.version}${cloudSaving ? " · saving…" : ""}` : `key v${key.version}`} · {keyed}/{key.questions.size} keyed · {graded?.sheets.length ?? 0} sheets in {graded ? graded.ms.toFixed(0) : "–"} ms
          </span>
          <CloudBar localTemplate={cloud ? null : template} />
          {!cloud && <SyncPanel pending={pending} teacherId={who.teacherId} endpoint={who.endpoint}
            onTeacher={(v) => { setTeacherId(v); setWho((w) => ({ ...w, teacherId: identity().teacherId })); }}
            onEndpoint={(v) => { setSyncEndpoint(v); setWho((w) => ({ ...w, endpoint: v.trim() })); }}
            onSync={async () => { const e = makeEngine(); if (!e) return null; const r = await e.syncOnce(); refreshPending(); if (r.pulled) load(template); return r; }} />}
          <button type="button" className={outline} onClick={generateDemo} disabled={!!cloud} title={cloud ? "Demo data is local-only; deselect the cloud exam to use it" : undefined}>Demo class</button>
          <button type="button" className={outline} disabled={!graded?.sheets.length || !!busy} onClick={() => scorecards()}>{busy ?? "Scorecards PDF"}</button>
          <button type="button" className={outline} disabled={!graded?.sheets.length}
            onClick={() => graded && download(`${key.examId}-v${key.version}-results.csv`, "﻿" + toCsv(gradebookRows(graded.sheets, key)), "text/csv;charset=utf-8")}>CSV</button>
          <button type="button" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`} disabled={!graded?.sheets.length} onClick={exportXlsx}>Excel</button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <div className="flex flex-wrap gap-1" role="tablist">
          {([
            ["key", "Answer key"],
            ["gradebook", `Students (${graded?.sheets.length ?? 0})${openConflicts ? ` · ${openConflicts} conflict${openConflicts > 1 ? "s" : ""}` : ""}`],
            ["roster", `Roster${roster ? ` · ${recon.summary.absent} absent` : ""}`],
            ["analysis", "Item analysis"],
            ["outcomes", `Outcomes${attainment?.belowTarget.length ? ` · ${attainment.belowTarget.length} below target` : ""}`],
          ] as const).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 ${tab === t ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-zinc-500">School
            <input className="w-44 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" placeholder="for scorecards" value={institute}
              onChange={(e) => { setInstitute(e.target.value); try { localStorage.setItem(INSTITUTE_KEY, e.target.value); } catch { /* ignore */ } }} />
          </label>
          <button type="button" className={outline} onClick={() => download(`${key.examId}-key-v${key.version}.json`, JSON.stringify(serializeKey(key), null, 2), "application/json")}>Export key</button>
          <label className={`${outline} cursor-pointer`}>Import key<input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { onKeyFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button type="button" className={outline} onClick={() => { if (confirm("Reset the answer key to blank?")) editKey(updateKey(keyFromTemplate(template), { })); }}>Reset key</button>
          {!cloud && (stored.length > 0 || demo.length > 0) && (
            <button type="button" className={outline} onClick={async () => {
              if (!confirm(`Remove ${stored.length} scanned and ${demo.length} demo sheets for this template? Override and sync logs are kept.`)) return;
              await clearScans(template.layoutHash).catch(() => {});
              setStored([]); setDemo([]);
            }}>Clear sheets</button>
          )}
        </div>
      </div>

      {notice && <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200">{notice} <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>dismiss</button></div>}

      <main className="flex-1 space-y-4 p-4">
        {tab === "key" && <KeyEditor answerKey={key} onChange={editKey} stats={stats} keySources={keySources} />}
        {tab === "gradebook" && (graded?.sheets.length ? (
          <>
            <ConflictPanel groups={groups} sheets={sourceById as Map<string, SyncedSheet>} onKeep={keep} onOpen={setOpenId} />
            <Gradebook sheets={graded.sheets} onOpen={setOpenId} names={names} />
          </>
        ) : <Empty />)}
        {tab === "roster" && <RosterPanel roster={roster} recon={recon} onImport={importRosterRecord} onOpen={setOpenId} download={(n, d, t) => download(n, d, t)} />}
        {tab === "analysis" && cloud?.analytics && (
          <p data-testid="server-analytics" className="text-xs text-zinc-500">
            Server snapshot ({cloud.analytics.status}{cloud.analytics.keyVersion ? `, key v${cloud.analytics.keyVersion}` : ""}): {cloud.analytics.gradedCount} sheets · KR-20 {cloud.analytics.kr20?.toFixed(2) ?? "–"} · {cloud.analytics.openConflicts} open conflicts
          </p>
        )}
        {tab === "analysis" && (graded && graded.sheets.length >= 2 ? <ItemAnalysisView report={graded.report} /> : <Empty />)}
        {tab === "outcomes" && (!key || !hasOutcomes(key) ? (
          <div className="mx-auto max-w-xl rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700" data-testid="outcomes-empty">
            <p className="font-medium text-zinc-700 dark:text-zinc-200">No syllabus outcomes on this exam yet</p>
            <p className="mt-1">Drop the course syllabus PDF in <Link href="/designer" className="text-indigo-600 underline">the designer</Link>: course outcomes are mapped to questions automatically, and attainment appears here once sheets are graded.</p>
          </div>
        ) : attainment && graded && graded.sheets.length ? (
          <OutcomesView report={attainment} exporting={exportingObe} onExport={exportAccreditation}
            subtitle={[syllabus ? `${syllabus.courseCode} ${syllabus.courseTitle}` : "Outcome codes from the answer key", examPeriod ? PERIOD_LABEL[examPeriod] : ""].filter(Boolean).join(" · ")} />
        ) : <Empty />)}
      </main>

      {openSheet && openSource && (
        <ReviewModal sheet={openSheet} scan={openSource.stored ?? cloudDetail.get(openSheet.sheetId) ?? null} rawFields={openSource.raw} patches={patchesBySheet.get(openSheet.sheetId) ?? []}
          answerKey={key} student={recon.studentBySheet.get(openSheet.sheetId) ?? null} teacherId={who.teacherId}
          onPatches={addPatches} onScorecard={() => scorecards(openSheet.sheetId)} onClose={() => setOpenId(null)} />
      )}
      {openId && !openSheet && openSource && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white">This sheet is a superseded or duplicate scan and is not graded. <button className="ml-2 underline" onClick={() => setOpenId(null)}>close</button></div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="grid min-h-60 place-items-center rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      <EmptyHero title="No sheets graded yet">Scan answer sheets on the <Link href="/scan" className="text-indigo-600 underline">Scan</Link> page, or click <b>Demo class</b> to try everything with simulated students.</EmptyHero>
    </div>
  );
}
