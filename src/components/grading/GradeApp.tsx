"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { keyFromScannedAnswers, keyFromTemplate, parseKey, serializeKey, updateKey } from "@/lib/grading/answer-key";
import { gradebookRows, toCsv, toWorkbook } from "@/lib/grading/export";
import { analyzeItems } from "@/lib/grading/item-analysis";
import { rescoreBatch } from "@/lib/grading/scorer";
import { mulberry32, simulateClass } from "@/lib/grading/simulate";
import type { AnswerKey, ChoiceRule, ScanInput } from "@/lib/grading/types";
import { type OMRTemplate, OMRTemplateSchema } from "@/lib/omr/schema";
import { clearScans, listScans, type StoredScan } from "@/lib/storage/scan-store";
import { readStoredKey, readStoredTemplate, writeStoredKey, writeStoredTemplate } from "@/lib/storage/template-store";
import Gradebook from "./Gradebook";
import InspectModal from "./InspectModal";
import ItemAnalysisView from "./ItemAnalysisView";
import KeyEditor from "./KeyEditor";

type Tab = "key" | "gradebook" | "analysis";
const btn = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
const outline = `${btn} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`;

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function GradeApp() {
  const [template, setTemplate] = useState<OMRTemplate | null>(null);
  const [key, setKey] = useState<AnswerKey | null>(null);
  const [stored, setStored] = useState<StoredScan[]>([]);
  const [demo, setDemo] = useState<ScanInput[]>([]);
  const [tab, setTab] = useState<Tab>("key");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((t: OMRTemplate) => {
    setTemplate(t);
    setKey(readStoredKey(t.layoutHash) ?? keyFromTemplate(t));
    listScans(t.layoutHash).then(setStored).catch(() => setStored([]));
  }, []);

  useEffect(() => {
    const t = readStoredTemplate();
    if (t) load(t);
  }, [load]);

  useEffect(() => { if (key && template) writeStoredKey(template.layoutHash, key); }, [key, template]);

  // ---- live rescoring (deferred so typing in the key editor never blocks)
  const inputs = useMemo<ScanInput[]>(() => [
    ...stored.map((s) => ({ sheetId: s.sheetId, layoutHash: s.layoutHash, fields: s.result.fields })),
    ...demo,
  ], [stored, demo]);
  const deferredKey = useDeferredValue(key);
  const graded = useMemo(() => {
    if (!deferredKey) return null;
    const t0 = performance.now();
    const sheets = rescoreBatch(inputs, deferredKey);
    const report = analyzeItems(sheets, deferredKey);
    return { sheets, report, ms: performance.now() - t0 };
  }, [inputs, deferredKey]);
  const stats = useMemo(() => new Map(graded?.report.items.map((i) => [i.questionNumber, i]) ?? []), [graded]);
  const storedById = useMemo(() => new Map(stored.map((s) => [s.sheetId, s])), [stored]);

  const keySources = useMemo(() => stored.slice(-20).reverse().map((s) => ({
    id: s.sheetId,
    label: `${s.name} (roll ${s.result.fields.rollNumber ?? "?"})`,
    apply: () => setKey((k) => (k ? keyFromScannedAnswers(k, s.result.fields) : k)),
  })), [stored]);

  function generateDemo() {
    if (!key) return;
    const rnd = mulberry32(key.version * 7919 + demo.length);
    // key every unkeyed choice question randomly so the demo has something to grade
    let k = key;
    const next = new Map(k.questions);
    let changed = false;
    for (const [n, r] of next) if (r.type === "choice" && !r.correct.length) { next.set(n, { ...r, correct: [Math.floor(rnd() * r.optionCount)] }); changed = true; }
    if (changed) k = { ...k, questions: next, version: k.version + 1 };
    // one deliberately "miskeyed" question (students' strong choice differs from the key) to show the warning
    const choice = [...k.questions.values()].filter((r): r is ChoiceRule => r.type === "choice" && !r.dropped);
    const trapQ = choice[Math.min(6, choice.length - 1)];
    const traps = trapQ ? { [trapQ.questionNumber]: (trapQ.correct[0] + 1) % trapQ.optionCount } : {};
    const { scans } = simulateClass(k, { students: 200, seed: Math.floor(rnd() * 1e9), traps, uncertainRate: 0.04 });
    setKey(k);
    setDemo(scans.map((s) => ({ ...s, sheetId: `demo-${s.sheetId}` })));
    setNotice(trapQ ? `Demo: 200 simulated students. Question ${trapQ.questionNumber} is miskeyed on purpose; see Item analysis.` : "Demo: 200 simulated students.");
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
      setKey({ ...k, version: Math.max(k.version, key.version + 1) });
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

  if (!template || !key) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold">Gradebook</h1>
        <p className="mb-4 text-sm text-zinc-500">Design a sheet first (it is remembered in this browser), or load its <code>template-coordinates.json</code>.</p>
        <div className="flex justify-center gap-2">
          <Link href="/" className={outline}>Open designer</Link>
          <label className={`${outline} cursor-pointer`}>Load template JSON<input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => onTemplateFile(e.target.files?.[0])} /></label>
        </div>
        {notice && <p className="mt-3 text-sm text-red-600">{notice}</p>}
      </div>
    );
  }

  const openSheet = openId ? graded?.sheets.find((s) => s.sheetId === openId) ?? null : null;
  const keyed = [...key.questions.values()].filter((r) => (r.type === "choice" ? r.correct.length : r.type === "numeric" ? r.value !== null : true)).length;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-[15px] font-semibold tracking-tight">Gradebook</h1>
        <nav className="flex gap-3 text-sm">
          <Link href="/" className="text-indigo-600 hover:underline dark:text-indigo-400">Designer</Link>
          <Link href="/scan" className="text-indigo-600 hover:underline dark:text-indigo-400">Scanner</Link>
        </nav>
        <span className="truncate text-sm text-zinc-500">{template.title} · <span className="font-mono text-xs">#{template.layoutHash}</span></span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Every edit creates a new key version and rescores all sheets">
            key v{key.version} · {keyed}/{key.questions.size} keyed · {graded?.sheets.length ?? 0} sheets in {graded ? graded.ms.toFixed(0) : "–"} ms
          </span>
          <button type="button" className={outline} onClick={generateDemo}>Demo class</button>
          <button type="button" className={outline} disabled={!graded?.sheets.length}
            onClick={() => graded && download(`${key.examId}-v${key.version}-results.csv`, "﻿" + toCsv(gradebookRows(graded.sheets, key)), "text/csv;charset=utf-8")}>CSV</button>
          <button type="button" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`} disabled={!graded?.sheets.length} onClick={exportXlsx}>Excel</button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <div className="flex gap-1" role="tablist">
          {([["key", "Answer key"], ["gradebook", `Students (${graded?.sheets.length ?? 0})`], ["analysis", "Item analysis"]] as const).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 ${tab === t ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={outline} onClick={() => download(`${key.examId}-key-v${key.version}.json`, JSON.stringify(serializeKey(key), null, 2), "application/json")}>Export key</button>
          <label className={`${outline} cursor-pointer`}>Import key<input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { onKeyFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button type="button" className={outline} onClick={() => { if (confirm("Reset the answer key to blank?")) setKey(updateKey(keyFromTemplate(template), {})); }}>Reset key</button>
          {(stored.length > 0 || demo.length > 0) && (
            <button type="button" className={outline} onClick={async () => {
              if (!confirm(`Remove ${stored.length} scanned and ${demo.length} demo sheets for this template?`)) return;
              await clearScans(template.layoutHash).catch(() => {});
              setStored([]); setDemo([]);
            }}>Clear sheets</button>
          )}
        </div>
      </div>

      {notice && <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200">{notice} <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>dismiss</button></div>}

      <main className="flex-1 p-4">
        {tab === "key" && <KeyEditor answerKey={key} onChange={setKey} stats={stats} keySources={keySources} />}
        {tab === "gradebook" && (graded?.sheets.length
          ? <Gradebook sheets={graded.sheets} onOpen={setOpenId} />
          : <Empty />)}
        {tab === "analysis" && (graded && graded.sheets.length >= 2 ? <ItemAnalysisView report={graded.report} /> : <Empty />)}
      </main>

      {openSheet && <InspectModal sheet={openSheet} scan={storedById.get(openSheet.sheetId) ?? null} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Empty() {
  return (
    <div className="grid min-h-60 place-items-center rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      <p>No sheets yet. Scan answer sheets on the <Link href="/scan" className="text-indigo-600 underline">Scanner</Link> page, or click <b>Demo class</b> to try the analytics with simulated students.</p>
    </div>
  );
}
