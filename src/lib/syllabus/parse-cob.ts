/**
 * Position-aware parser for the University of San Agustin COB/COC syllabus template
 * ("COURSE SPECIFICATIONS FOR …": a cell table of course facts, PEO | PO side by side, an outcomes
 * table with AGA / PO link columns, then a six-column module table grouped PRELIM / MIDTERM / FINALS).
 *
 * Text extraction flattens table cells that share a baseline into one line, which interleaves the
 * columns, so this parser works from item coordinates instead: it assigns every text run to a column,
 * walks the rows top to bottom (page after page) and builds each module from its own cells.
 *
 * Returns null when the document is not this layout, so the line parser (CLASE format) takes over.
 */
import { CLASE_POLICY, findTerm, GRADING_DEFAULT_WARNING, type PdfItem, type PdfPageItems } from "./defaults";
import type { CourseOutcome, ExamPeriod, LearningOutcome, ModuleMode, ParseResult, ProgramOutcome, Syllabus, SyllabusExam, SyllabusModule, SyllabusOverview } from "./types";
import { periodForModule } from "./types";

const ROW_TOL = 3.2;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const isNA = (s: string) => /^n\s*\/?\s*a\.?$/i.test(s.trim());

// ------------------------------------------------------------------ small text helpers

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "vs"]);
const ACRONYMS = new Set(["ICT", "IT", "HR", "AI", "PC", "OBE", "ERP", "CRM", "MS", "MICE", "BSHM", "BSTM", "GDS", "PNR"]);
/** "OVERVIEW OF BUSINESS TOOLS" → "Overview of Business Tools"; text that already has lower case is left alone. */
export function titleCase(s: string): string {
  const t = clean(s);
  if (!t || t !== t.toUpperCase()) return t;
  return t.split(" ").map((w, i) => {
    const letters = w.replace(/[^A-Za-z]/g, "");
    if (letters && (ACRONYMS.has(letters) || (letters.length <= 4 && !/[AEIOUY]/.test(letters)))) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lower)) return lower;
    return lower.replace(/(^|[-/(])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  }).join(" ");
}

interface Row<T extends { y: number }> { y: number; items: T[] }
/** Cluster items whose baselines are within `tol` of the row's first item; rows are top-to-bottom. */
function clusterRows<T extends { y: number }>(items: T[], tol = ROW_TOL): Row<T>[] {
  const rows: Row<T>[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  return rows;
}
const textRows = (items: PdfItem[]): string[] => clusterRows(items).map((r) => clean(r.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")));
const right = (i: PdfItem) => i.x + i.w;
const find = (items: PdfItem[], re: RegExp) => items.find((i) => re.test(i.str.trim()));

/** Lettered entries ("A. text" with wrapped continuation lines) → code/description pairs, first occurrence wins. */
function letteredEntries(rows: string[]): ProgramOutcome[] {
  const out: ProgramOutcome[] = [];
  let current: ProgramOutcome | null = null;
  for (const row of rows) {
    const m = row.match(/^([A-Z])\.\s*(\S.*)$/);
    if (m) {
      // a repeated letter is ignored, together with its wrapped lines
      current = out.some((o) => o.code === m[1]) ? null : { code: m[1], description: clean(m[2]) };
      if (current) out.push(current);
    } else if (current) current.description = clean(`${current.description} ${row}`);
  }
  return out;
}

// ------------------------------------------------------------------ page 1–2: overview, POs, AGA, COs

function parseTitleStrip(p1: PdfItem[]): { code: string; title: string } | null {
  const head = find(p1, /^COURSE SPECIFICATIONS? FOR\b/i);
  if (!head) return null;
  const same = p1.filter((i) => Math.abs(i.y - head.y) <= 3 && i.x >= head.x).sort((a, b) => a.x - b.x).map((i) => i.str).join(" ");
  const rest = clean(same.replace(/^COURSE SPECIFICATIONS? FOR\s*/i, ""));
  const m = rest.match(/^(.+?)\s*[-–]\s+(.+)$/);
  return m ? { code: clean(m[1]), title: titleCase(m[2]) } : null;
}

/** Value cell to the right of a label on the same row, stopping at `stopX` (the next label's left edge). */
function cellRight(items: PdfItem[], label: PdfItem | undefined, stopX = Infinity): string {
  if (!label) return "";
  const vals = items.filter((i) => i !== label && Math.abs(i.y - label.y) <= 4 && i.x > right(label) + 1 && i.x < stopX);
  return clean(vals.sort((a, b) => a.x - b.x).map((i) => i.str).join(" "));
}

function parseOverviewCells(items: PdfItem[]): { code: string; title: string; level: string; credits: string } {
  const codeLabel = find(items, /^Course Code$/i);
  const creditLabel = find(items, /^Credit$/i);
  const code = cellRight(items, codeLabel, creditLabel ? creditLabel.x - 2 : Infinity);
  const level = titleCase(cellRight(items, find(items, /^Course Level$/i)));

  let credits = "";
  const units = find(items, /^Units$/i);
  if (creditLabel && units) {
    const colon = items.find((i) => i.str.trim() === ":" && Math.abs(i.y - units.y) <= 4);
    const edge = Math.max(right(creditLabel), right(units), colon ? right(colon) : 0) + 2;
    const vals = items.filter((i) => i.x > edge && i.y >= units.y - 4 && i.y <= creditLabel.y + 4);
    credits = clean(textRows(vals).join(" ")).replace(/(\d)\s*(units?)/gi, "$1 $2");
  }

  let title = "";
  const titleLabel = find(items, /^Course Title$/i);
  // "Course Description" is a two-line label ("Course" / "Description") that bounds the title cell on its right
  const descLabels = titleLabel ? items.filter((i) => /^(?:Course|Description)$/i.test(i.str.trim()) && i.x > right(titleLabel) && Math.abs(i.y - titleLabel.y) <= 30) : [];
  if (titleLabel && descLabels.length) {
    const xMax = Math.min(...descLabels.map((i) => i.x)) - 3;
    const prereq = find(items, /^Course Prerequisites/i);
    const yMin = prereq ? prereq.y + 8 : titleLabel.y - 60;
    const cell = items.filter((i) => i.x > right(titleLabel) + 3 && i.x < xMax && i.y > yMin && i.y < titleLabel.y + 40);
    title = clean(textRows(cell).join(" "));
  }
  return { code, title, level, credits };
}

function parsePoColumn(p: PdfPageItems): { pos: ProgramOutcome[]; program?: string; aga: ProgramOutcome[] } {
  const hdr = find(p.items, /^PROGRAM OUTCOMES\b/i);
  if (!hdr) return { pos: [], aga: [] };
  const rows = textRows(p.items.filter((i) => i.x >= hdr.x - 6 && i.y < hdr.y - 3));
  const program = rows.map((r) => r.match(/students of the\s+([A-Z][A-Za-z]{1,9})\s+program/)?.[1]).find(Boolean);
  const agaHdr = find(p.items, /^AUGUSTINIAN GRADUATE ATTRIBUTES/i);
  const agaRows = agaHdr ? textRows(p.items.filter((i) => i.x >= agaHdr.x - 4 && i.y < agaHdr.y - 3 && i.y > hdr.y + 3)) : [];
  return { pos: letteredEntries(rows), program, aga: letteredEntries(agaRows) };
}

const LETTERS = (s: string) => s.toUpperCase().match(/\b[A-Z]\b/g) ?? [];

/** CO table: marker "CO n:" at the left, description in the middle, AGA and PO link letters in their own columns. */
function parseOutcomeTable(p: PdfPageItems): CourseOutcome[] {
  const hdrs = p.items.filter((i) => /^Course Outcomes:?$/i.test(i.str.trim())).sort((a, b) => a.x - b.x);
  const aga = p.items.filter((i) => /^AGA$/i.test(i.str.trim())).sort((a, b) => a.x - b.x)[0];
  const po = p.items.filter((i) => /^PO Code$/i.test(i.str.trim())).sort((a, b) => a.x - b.x)[0];
  if (!hdrs.length || !aga || !po) return [];
  const link = p.items.filter((i) => /^Link\(s\)$/i.test(i.str.trim()) && i.x < right(po) + 20).sort((a, b) => a.y - b.y)[0];
  const top = (link ?? aga).y - 3;
  const agaLeft = aga.x - 22;
  const poLeft = po.x - 8;
  const panelEnd = hdrs[1] ? hdrs[1].x - 3 : Infinity;
  const data = p.items.filter((i) => i.y < top && i.x < panelEnd);
  const markers = data.map((i) => ({ i, m: i.str.trim().match(/^CO\s*[-]?\s*(\d{1,2})\s*:?$/i) })).filter((x) => x.m && x.i.x < agaLeft - 120).map((x) => ({ y: x.i.y, n: Number(x.m![1]), right: right(x.i) }));
  if (!markers.length) return [];
  const nearest = (y: number) => markers.reduce((best, m) => (Math.abs(m.y - y) < Math.abs(best.y - y) ? m : best), markers[0]);
  const byN = new Map(markers.map((m) => [m.n, { desc: [] as PdfItem[], aga: new Set<string>(), po: new Set<string>() }]));
  for (const it of data) {
    if (/^CO\s*[-]?\s*\d{1,2}\s*:?$/i.test(it.str.trim())) continue;
    const slot = byN.get(nearest(it.y).n)!;
    if (it.x >= poLeft) for (const l of LETTERS(it.str)) slot.po.add(l);
    else if (it.x >= agaLeft) for (const l of LETTERS(it.str)) slot.aga.add(l);
    else if (it.x > Math.min(...markers.map((m) => m.right))) slot.desc.push(it);
  }
  return [...byN].sort((a, b) => a[0] - b[0]).map(([n, s]) => ({
    code: `CO${n}`,
    description: clean(textRows(s.desc).join(" ")).slice(0, 4_000),
    programOutcomes: [...s.po].sort(),
    ...(s.aga.size ? { agaLinks: [...s.aga].sort() } : {}),
  }));
}

// ------------------------------------------------------------------ module table

type ColNo = 1 | 2 | 3 | 4 | 5 | 6;
interface Cols { b12: number; b23: number; b34: number; b45: number; b56: number }
interface Band { top: number; bottom: number; cols: Cols }
interface Cell { page: number; item: PdfItem; col: ColNo }

/** A table header (Module/Topic, CO Link(s), Learning Outcomes, TLA, Assessment Tasks, Timeframe) and the column edges it implies. */
function findBands(items: PdfItem[]): Band[] {
  const bands: Band[] = [];
  for (const lo of items.filter((i) => /^Learning Outcomes$/i.test(i.str.trim()))) {
    const near = items.filter((i) => i.y <= lo.y + 14 && i.y >= lo.y - 24);
    const link = near.filter((i) => /^Link\(s\)$/i.test(i.str.trim()) && i.x < lo.x).sort((a, b) => a.x - b.x)[0];
    const tla = find(near, /^Teaching and Learning$/i);
    const asm = find(near, /^Assessment$/i);
    const time = find(near, /^Timeframe$/i);
    if (!link || !tla || !asm || !time) continue;
    bands.push({ top: lo.y + 14, bottom: lo.y - 24, cols: { b12: link.x - 4, b23: right(link) + 4, b34: tla.x - 16, b45: asm.x - 12, b56: time.x - 14 } });
  }
  return bands.sort((a, b) => b.top - a.top);
}
const colOf = (x: number, c: Cols): ColNo => (x < c.b12 ? 1 : x < c.b23 ? 2 : x < c.b34 ? 3 : x < c.b45 ? 4 : x < c.b56 ? 5 : 6);

const PERIOD_HEADING = /^(PRELIM|MIDTERM|FINALS?)$/i;
const EXAM_TITLE = /^(PRELIM|MIDTERM|FINALS?)\s+EXAMINATIONS?$/i;
const periodOf = (s: string): ExamPeriod => (/^PRELIM/i.test(s) ? "PRELIM" : /^MIDTERM/i.test(s) ? "MIDTERM" : "FINAL");

/** "Modules 1, 2, 3, and 4" / "Modules 1-4" / "M1 to M3" → [1,2,3,4] */
function coverageNumbers(text: string): number[] {
  const set = new Set<number>();
  const expanded = text.replace(/(\d+)\s*(?:-|–|to|through)\s*M?(\d+)/gi, (_m, a: string, b: string) => {
    const lo = Number(a), hi = Number(b);
    return hi >= lo && hi - lo < 40 ? Array.from({ length: hi - lo + 1 }, (_x, k) => lo + k).join(" ") : `${a} ${b}`;
  });
  for (const n of expanded.match(/\d+/g) ?? []) set.add(Number(n));
  return [...set].sort((a, b) => a - b);
}

interface ModeBuild { tla: string[]; asm: string[]; hours?: number }
interface ModBuild {
  number: number; period: ExamPeriod; title: string[]; phase: "title" | "desc" | "topics";
  topics: string[]; cos: Set<string>; los: { n: string; text: string }[]; lec: ModeBuild; lab: ModeBuild;
}

function addEntry(list: string[], text: string) {
  const dash = /^[-–•▪◦·]\s*/;
  const body = text.replace(dash, "").trim();
  if (!body || isNA(body)) return;
  if (dash.test(text) || !list.length) list.push(body); else list[list.length - 1] = clean(`${list[list.length - 1]} ${body}`);
}

function finishMode(m: ModeBuild): ModuleMode | undefined {
  if (!m.tla.length && !m.asm.length && m.hours === undefined) return undefined;
  return { tla: m.tla.slice(0, 20).map((t) => t.slice(0, 200)), assessments: m.asm.slice(0, 20).map((t) => t.slice(0, 200)), ...(m.hours !== undefined ? { hours: m.hours } : {}) };
}

function finishModule(b: ModBuild): SyllabusModule {
  const lecture = finishMode(b.lec);
  const lab = finishMode(b.lab);
  const hasHours = b.lec.hours !== undefined || b.lab.hours !== undefined;
  const learningOutcomes: LearningOutcome[] = b.los.slice(0, 40).map((l) => ({ code: `LO ${l.n}`, description: clean(l.text).slice(0, 500) }));
  return {
    number: b.number,
    title: titleCase(b.title.join(" ")).slice(0, 300),
    topics: b.topics.slice(0, 200).map((t) => clean(t).slice(0, 500)).filter(Boolean),
    courseOutcomes: [...b.cos].sort((a, c) => Number(a.slice(2)) - Number(c.slice(2))),
    period: b.period,
    ...(hasHours ? { hours: (b.lec.hours ?? 0) + (b.lab.hours ?? 0) } : {}),
    assessed: b.lec.asm.length + b.lab.asm.length > 0,
    ...(learningOutcomes.length ? { learningOutcomes } : {}),
    ...(lecture ? { lecture } : {}),
    ...(lab ? { lab } : {}),
  };
}

function parseModuleTable(pages: PdfPageItems[]): { modules: SyllabusModule[]; exams: SyllabusExam[]; tableStart: number } {
  const cells: Cell[] = [];
  let tableStart = -1;
  pages.forEach((p, pi) => {
    const bands = findBands(p.items);
    if (!bands.length) return;
    if (tableStart < 0) tableStart = pi;
    const firstTop = bands[0].top;
    for (const item of p.items) {
      if (item.y >= firstTop) continue; // the repeated document header
      if (bands.some((b) => item.y <= b.top && item.y >= b.bottom)) continue; // a (repeated) column header
      const band = [...bands].reverse().find((b) => b.top >= item.y) ?? bands[0];
      cells.push({ page: pi, item, col: colOf(item.x, band.cols) });
    }
  });
  if (!cells.length) return { modules: [], exams: [], tableStart: -1 };

  // Examination rows: title in the first column, coverage text beside it, hours in the last column.
  const consumed = new Set<Cell>();
  const examAt = new Set<Cell>();
  const exams: SyllabusExam[] = [];
  for (const c of cells) {
    if (c.col !== 1 || !EXAM_TITLE.test(clean(c.item.str))) continue;
    examAt.add(c);
    const y0 = c.item.y;
    const same = cells.filter((o) => o.page === c.page);
    const cov = same.filter((o) => o.col === 4 && o.item.y >= y0 - 26 && o.item.y <= y0 + 18);
    const hrs = same.filter((o) => o.col === 6 && Math.abs(o.item.y - y0) <= 4);
    cov.forEach((o) => consumed.add(o)); hrs.forEach((o) => consumed.add(o));
    const covText = textRows(cov.map((o) => o.item)).join(" ").replace(/Coverage:?/gi, " ");
    const hours = Number(hrs.map((o) => o.item.str).join(" ").match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)/i)?.[1]);
    exams.push({
      period: periodOf(clean(c.item.str)),
      title: titleCase(clean(c.item.str)).slice(0, 100),
      ...(Number.isFinite(hours) ? { hours } : {}),
      coverage: coverageNumbers(covText).slice(0, 40),
    });
  }

  // Walk rows top to bottom, page after page, keeping the current period / module / teaching mode.
  const ordered: Cell[] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    // wrap rather than copy, so the `consumed` / `examAt` identity checks below keep working
    for (const row of clusterRows(cells.filter((c) => c.page === pi).map((cell) => ({ cell, y: cell.item.y })))) {
      ordered.push(...row.items.map((r) => r.cell).sort((a, b) => a.col - b.col || a.item.x - b.item.x));
    }
  }
  const builds: ModBuild[] = [];
  let period: ExamPeriod | null = null;
  let cur: ModBuild | null = null;
  let mode: "lec" | "lab" = "lec";
  let openLo = false;

  for (const cell of ordered) {
    if (consumed.has(cell)) continue;
    const text = clean(cell.item.str);
    if (!text) continue;
    if (examAt.has(cell)) { cur = null; openLo = false; continue; }
    if (cell.col === 1) {
      if (PERIOD_HEADING.test(text)) { period = periodOf(text); cur = null; openLo = false; continue; }
      const mk = text.match(/^M(\d{1,2})(?:\.\s*(.*)|\.?)$/); // "M0." / "M3" / "M2. AUTOMATION TOOLS"
      if (mk) {
        cur = { number: Number(mk[1]), period: period ?? periodForModule(Number(mk[1])), title: mk[2] ? [mk[2]] : [], phase: "title", topics: [], cos: new Set(), los: [], lec: { tla: [], asm: [] }, lab: { tla: [], asm: [] } };
        builds.push(cur); mode = "lec"; openLo = false;
        continue;
      }
      if (!cur) continue;
      const topic = text.match(/^\d+\.\d+\.?\s*(.*)$/);
      if (topic) { cur.topics.push(topic[1]); cur.phase = "topics"; continue; }
      if (cur.phase === "title" && text === text.toUpperCase() && /[A-Z]/.test(text)) { cur.title.push(text); continue; }
      if (cur.phase === "title") { cur.phase = "desc"; continue; }
      if (cur.phase === "topics" && cur.topics.length) cur.topics[cur.topics.length - 1] += ` ${text}`;
      continue;
    }
    if (!cur) continue;
    if (cell.col === 2) { for (const n of text.matchAll(/\bCO\s*-?\s*(\d{1,2})/gi)) cur.cos.add(`CO${Number(n[1])}`); continue; }
    if (cell.col === 3) {
      if (/^LEC$/i.test(text)) { mode = "lec"; openLo = false; continue; }
      if (/^LAB$/i.test(text)) { mode = "lab"; openLo = false; continue; }
      const lo = text.match(/^LO\s*(\d+\.\d+)\.?\s*(.*)$/i);
      if (lo) { cur.los.push({ n: lo[1], text: lo[2] }); openLo = true; continue; }
      if (openLo && cur.los.length) cur.los[cur.los.length - 1].text += ` ${text}`;
      continue;
    }
    const m = mode === "lec" ? cur.lec : cur.lab;
    if (cell.col === 4) addEntry(m.tla, text);
    else if (cell.col === 5) addEntry(m.asm, text);
    else { const h = text.match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i); if (h) m.hours = Number(h[1]); }
  }

  // Same module number twice (a repeated header/footer artefact): keep the first.
  const seen = new Set<number>();
  const modules = builds.filter((b) => !seen.has(b.number) && seen.add(b.number)).sort((a, b) => a.number - b.number).map(finishModule);
  return { modules, exams, tableStart };
}

// ------------------------------------------------------------------ entry point

export function parseCobPages(pages: PdfPageItems[], opts: { fileName?: string } = {}): ParseResult | null {
  const { modules, exams, tableStart } = parseModuleTable(pages);
  if (!modules.length || tableStart < 0) return null;

  const front = pages.slice(0, tableStart);
  const frontItems = front.flatMap((p) => p.items);
  const strip = parseTitleStrip(frontItems);
  // table cells are read from the one page that holds the labels: rows on different pages must not mix
  const cellPage = front.find((p) => find(p.items, /^Course Code$/i));
  const cells = cellPage ? parseOverviewCells(cellPage.items) : { code: "", title: "", level: "", credits: "" };
  const { pos, program, aga } = front[0] ? parsePoColumn(front[0]) : { pos: [], program: undefined, aga: [] };
  const courseOutcomes = front.flatMap(parseOutcomeTable).filter((c, i, all) => all.findIndex((o) => o.code === c.code) === i);

  const courseCode = cells.code || (strip ? strip.code.replace(/\s+/g, "") : "");
  const courseTitle = cells.title || strip?.title || "";
  const college = clean(frontItems.find((i) => /^College of\b/i.test(i.str.trim()))?.str ?? "");
  const department = clean(frontItems.find((i) => /^Department of\b/i.test(i.str.trim()))?.str ?? "");
  const overview: SyllabusOverview = {
    ...(college ? { college } : {}),
    ...(department ? { department } : {}),
    ...(program ? { program } : {}),
    ...(cells.level ? { courseLevel: cells.level } : {}),
    ...(cells.credits ? { creditUnits: cells.credits } : {}),
  };

  const poCodes = new Set(pos.map((p) => p.code));
  const cos = courseOutcomes.map((c) => ({ ...c, programOutcomes: poCodes.size ? c.programOutcomes.filter((p) => poCodes.has(p)) : c.programOutcomes }));
  const known = new Set(cos.map((c) => c.code));

  const warnings: string[] = [];
  if (!courseCode) warnings.push("Course code not found — please enter it.");
  if (!courseTitle) warnings.push("Course title not found — please enter it.");
  if (!pos.length) warnings.push("No program outcomes found.");
  if (!cos.length) warnings.push("No course outcomes found.");
  for (const c of new Set(modules.flatMap((m) => m.courseOutcomes))) if (known.size && !known.has(c)) warnings.push(`Module references ${c}, which is not in the outcomes list.`);
  warnings.push(GRADING_DEFAULT_WARNING);

  const syllabus: Syllabus = {
    courseCode: (courseCode || "UNKNOWN").slice(0, 40),
    courseTitle: (courseTitle || "Untitled course").slice(0, 300),
    term: findTerm(opts.fileName ?? "").slice(0, 60),
    programOutcomes: pos.slice(0, 26),
    courseOutcomes: cos,
    modules,
    gradingPolicy: { ...CLASE_POLICY, components: CLASE_POLICY.components.map((c) => ({ ...c })) },
    ...(Object.keys(overview).length ? { overview } : {}),
    ...(aga.length ? { graduateAttributes: aga.slice(0, 26) } : {}),
    ...(exams.length ? { exams: exams.slice(0, 6) } : {}),
  };
  return { syllabus, warnings };
}
