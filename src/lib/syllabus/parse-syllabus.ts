/**
 * Syllabus parser for the University of San Agustin course-syllabus layout.
 *
 * `parseSyllabusText` is pure (text in, structured syllabus out) so it is unit-testable and runs
 * anywhere; `extractPdfText` turns a PDF into the line-oriented text it expects using pdfjs-dist
 * (loaded lazily, browser or Node). Table cells that sit on one visual row are joined with " | ",
 * which is how CO → PO mapping columns survive text extraction.
 *
 * Recognised (case-insensitive, tolerant of wrapped lines and bullets):
 *   header   : "Course Code: IT 321" / "Course Title: …" / or a first line "IT 321 Information Assurance…"
 *   POs      : "PO A …", "A. …", "(a) …" inside the Program Outcomes section (A–I)
 *   COs      : "CO1 …", "CO 2: …" (+ "PO A, C" / "| A, C" links) inside the Course Outcomes section
 *   modules  : "Module 1: Title" followed by topics, with CO tokens and optional hours
 *   grading  : "Lecture … 67%", "Laboratory … 33%", "Major Exam … 50%", "Lab Exam … 30%"
 */
import { type CourseOutcome, type GradingComponent, type GradingPolicy, type ParseResult, type ProgramOutcome, periodForModule, type Syllabus, type SyllabusModule } from "./types";

/** USA CLASE grading standard, used when the syllabus does not state its own weights. */
export const CLASE_POLICY: GradingPolicy = {
  lectureWeight: 67,
  labWeight: 33,
  components: [
    { name: "Major Exam", weight: 50, group: "lecture" },
    { name: "Class Standing", weight: 50, group: "lecture" },
    { name: "Laboratory Exam", weight: 30, group: "lab" },
    { name: "Laboratory Activities", weight: 70, group: "lab" },
  ],
  source: "default",
};

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\|\s*$/, "").trim();
const PO_LETTERS = "A-I";

type Heading = "po" | "co" | "modules" | "grading" | null;
function headingOf(line: string): Heading {
  const l = line.trim().toLowerCase().replace(/[:\s]+$/, "");
  if (l.length > 70) return null;
  if (/^(?:\d+[.)]\s*)?(?:program|programme)\s+(?:educational\s+)?outcomes?\b/.test(l) && !/^po\b/.test(l)) return "po";
  if (/^(?:\d+[.)]\s*)?(?:course|intended\s+learning)\s+outcomes?\b/.test(l)) return "co";
  if (/^(?:\d+[.)]\s*)?(?:course\s+(?:content|schedule|outline|modules?)|learning\s+modules?|modules?\s+(?:and\s+)?topics|table of contents|schedule of topics)\b/.test(l)) return "modules";
  if (/^(?:\d+[.)]\s*)?(?:grading|grading\s+(?:system|policy)|evaluation|assessment|course\s+requirements|basis\s+of\s+grades?|computation\s+of\s+grades?)\b/.test(l)) return "grading";
  return null;
}

/** Split into labelled sections by heading lines. Text before any heading is section `null`. */
function sections(lines: string[]): { head: Heading; lines: string[] }[] {
  const out: { head: Heading; lines: string[] }[] = [{ head: null, lines: [] }];
  for (const line of lines) {
    const h = headingOf(line);
    if (h) out.push({ head: h, lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

function parseHeader(lines: string[]): { courseCode: string; courseTitle: string; term: string } {
  const text = lines.join("\n");
  let courseCode = "";
  let courseTitle = "";
  const labelledCode = text.match(/course\s*code\s*[:\-–]\s*([A-Za-z]{2,6})\s*-?\s*(\d{2,4}[A-Za-z]?)/i);
  if (labelledCode) courseCode = `${labelledCode[1].toUpperCase()} ${labelledCode[2].toUpperCase()}`;
  const labelledTitle = text.match(/course\s*title\s*[:\-–]\s*(.+)/i);
  if (labelledTitle) courseTitle = clean(labelledTitle[1].split("|")[0]);
  if (!courseCode || !courseTitle) {
    for (const raw of lines.slice(0, 25)) {
      const m = raw.trim().match(/^([A-Z]{2,5})\s?-?(\d{3}[A-Z]?)\s*[:\-–|]?\s+(\S.{2,})$/);
      if (m && !/^(?:co|po)$/i.test(m[1])) {
        courseCode ||= `${m[1]} ${m[2]}`;
        courseTitle ||= clean(m[3].replace(/\s*\|.*$/, ""));
        break;
      }
    }
  }
  const termMatch = text.match(/((?:1st|2nd|3rd|first|second|summer)\s+(?:semester|sem\.?|term)[\s,]*(?:(?:A\.?Y\.?|S\.?Y\.?|academic year)\s*)?\d{4}\s*[-–/]\s*\d{2,4})/i)
    ?? text.match(/((?:A\.?Y\.?|S\.?Y\.?)\s*\d{4}\s*[-–/]\s*\d{2,4}\s*[,\-–]?\s*(?:1st|2nd|first|second)\s+(?:semester|sem\.?|term))/i);
  return { courseCode, courseTitle, term: termMatch ? clean(termMatch[1]) : "" };
}

/** Group lines into items: `start` recognises an item's first line, other lines wrap onto the previous item. */
function collect<T>(lines: string[], start: (line: string) => { key: T; text: string } | null): { key: T; text: string }[] {
  const items: { key: T; text: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const head = start(line);
    if (head) items.push(head);
    else if (items.length && !/^(?:page\s+\d+|\d+)$/i.test(line)) items[items.length - 1].text += ` ${line}`;
  }
  return items;
}

const stripLead = (t: string) => clean(t.replace(/^[\s|:.\-–]+/, ""));

function parsePOs(lines: string[]): ProgramOutcome[] {
  const labelled = new RegExp(`^PO(?![A-Za-z])[\\s\\-]*\\(?([${PO_LETTERS}])(?![A-Za-z])\\)?\\s*[.):\\-–|]?\\s*(\\S.*)$`, "i");
  const bare = new RegExp(`^\\(?([${PO_LETTERS}])[.):\\-–|]\\s*(\\S.*)$`, "i");
  const found = collect(lines, (line) => {
    const m = line.match(labelled) ?? line.match(bare);
    return m ? { key: m[1].toUpperCase(), text: m[2] } : null;
  });
  const byCode = new Map<string, string>();
  for (const f of found) if (!byCode.has(f.key)) byCode.set(f.key, stripLead(f.text));
  return [...byCode].sort((a, b) => a[0].localeCompare(b[0])).map(([code, description]) => ({ code, description }));
}

/** "PO A, C and E" / "POs: A, B" / trailing "| A, C" → ["A","C","E"] */
function poLinks(text: string): { links: string[]; rest: string } {
  const links = new Set<string>();
  let rest = text;
  const labelled = new RegExp(`\\(?\\[?\\bPOs?\\b[\\s:\\-]*((?:PO[\\s\\-]*)?[${PO_LETTERS}](?:\\s*(?:,|;|/|&|\\band\\b)\\s*(?:PO[\\s\\-]*)?[${PO_LETTERS}])*)\\b\\)?\\]?`, "gi");
  rest = rest.replace(labelled, (_m, g: string) => { for (const l of g.toUpperCase().match(new RegExp(`(?<![A-Z])[${PO_LETTERS}](?![A-Z])`, "g")) ?? []) links.add(l); return " "; });
  const trailing = rest.match(new RegExp(`\\|\\s*((?:[${PO_LETTERS}])(?:\\s*[,;/&]?\\s*[${PO_LETTERS}])*)\\s*$`));
  if (trailing) {
    for (const l of trailing[1].match(new RegExp(`[${PO_LETTERS}]`, "g")) ?? []) links.add(l);
    rest = rest.slice(0, trailing.index);
  }
  return { links: [...links].sort(), rest: clean(rest) };
}

function parseCOs(lines: string[]): CourseOutcome[] {
  const found = collect(lines, (line) => {
    const m = line.match(/^(?:CO|CLO|ILO)[\s\-]*(\d{1,2})\s*[.):\-–|]?\s*(\S.*)$/i);
    return m ? { key: `CO${Number(m[1])}`, text: m[2] } : null;
  });
  const byCode = new Map<string, CourseOutcome>();
  for (const f of found) {
    if (byCode.has(f.key)) continue;
    const { links, rest } = poLinks(f.text);
    byCode.set(f.key, { code: f.key, description: stripLead(rest), programOutcomes: links });
  }
  return [...byCode.values()].sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)));
}

function coTokens(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(/\b(?:CO|CLO)[\s\-]*(\d{1,2})(?:\s*(?:,|&|and|\/)\s*(?:CO|CLO)?[\s\-]*(\d{1,2}))*/gi)) {
    for (const n of m[0].match(/\d{1,2}/g) ?? []) set.add(`CO${Number(n)}`);
  }
  return [...set].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

function parseModules(lines: string[]): SyllabusModule[] {
  const mods: { number: number; title: string; body: string[] }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:module|unit)\s+(\d{1,2})\b\s*[:.\-–|]?\s*(.*)$/i);
    if (m) mods.push({ number: Number(m[1]), title: clean(m[2]), body: [] });
    else if (mods.length) mods[mods.length - 1].body.push(line);
  }
  const seen = new Set<number>();
  return mods.filter((m) => !seen.has(m.number) && seen.add(m.number)).sort((a, b) => a.number - b.number).map((m) => {
    const all = [m.title, ...m.body].join(" | ");
    const hoursM = all.match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i);
    // Titles sometimes carry the CO list after a pipe: "Intro to Security | CO1, CO2"
    const title = clean(m.title.split("|")[0].replace(/\b(?:CO|CLO)[\s\-]*\d.*$/i, ""));
    const topics = m.body
      .flatMap((l) => l.split("|"))
      .map((l) => clean(l.replace(/^[\-•*▪◦·o]\s+/, "").replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")))
      .filter((l) => l && !/^(?:CO|CLO)[\s\-]*\d/i.test(l) && !/^\d+(?:\.\d+)?\s*(?:hrs?|hours?)$/i.test(l));
    return { number: m.number, title, topics, courseOutcomes: coTokens(all), period: periodForModule(m.number), ...(hoursM ? { hours: Number(hoursM[1]) } : {}) };
  });
}

function parseGrading(lines: string[], whole: string[]): GradingPolicy {
  const comps: GradingComponent[] = [];
  const pctLine = /^(.{2,60}?)[\s.:|\-–]*?(\d{1,3}(?:\.\d+)?)\s*%/;
  for (const raw of lines) {
    const m = raw.trim().match(pctLine);
    if (!m) continue;
    const name = clean(m[1].replace(/[|:]+/g, " ")).replace(/\s*\(.*$/, "");
    if (!name || /^total$/i.test(name)) continue;
    const weight = Number(m[2]);
    if (weight <= 0 || weight > 100) continue;
    comps.push({ name, weight, group: /\blab/i.test(name) ? "lab" : "lecture" });
  }
  const find = (re: RegExp) => whole.map((l) => l.match(re)).find(Boolean);
  const lec = find(/\blecture\b[^\d%]{0,25}(\d{1,3}(?:\.\d+)?)\s*%/i);
  const lab = find(/\blab(?:oratory)?\b(?![^\d%]*\bexam)[^\d%]{0,25}(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (lec && lab && Math.abs(Number(lec[1]) + Number(lab[1]) - 100) < 0.5) {
    const named = comps.filter((c) => !/^(?:lecture|laboratory|lab)$/i.test(c.name));
    return { lectureWeight: Number(lec[1]), labWeight: Number(lab[1]), components: named.length ? named : CLASE_POLICY.components, source: "syllabus" };
  }
  return { ...CLASE_POLICY, components: comps.length >= 2 ? comps : CLASE_POLICY.components, source: comps.length >= 2 ? "syllabus" : "default" };
}

export function parseSyllabusText(text: string): ParseResult {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trimEnd());
  const secs = sections(lines);
  const body = (h: Exclude<Heading, null>) => secs.filter((s) => s.head === h).flatMap((s) => s.lines);

  const header = parseHeader(lines);
  // Fall back to scanning the whole document when a section heading is missing.
  const poLines = body("po");
  const coLines = body("co");
  const modLines = body("modules");
  const programOutcomes = parsePOs(poLines.length ? poLines : []);
  let courseOutcomes = parseCOs(coLines.length ? coLines : lines);
  const modules = parseModules(modLines.length ? modLines : lines);
  const gradingPolicy = parseGrading(body("grading"), lines);

  // Modules may list COs that the outcomes section did not (rare); keep only known + unseen codes consistent.
  const known = new Set(courseOutcomes.map((c) => c.code));
  const warnings: string[] = [];
  if (!header.courseCode) warnings.push("Course code not found — please enter it.");
  if (!header.courseTitle) warnings.push("Course title not found — please enter it.");
  if (!programOutcomes.length) warnings.push("No program outcomes (PO A–I) found.");
  if (!courseOutcomes.length) warnings.push("No course outcomes (CO1–CO4) found.");
  if (!modules.length) warnings.push("No modules found; the Table of Specifications cannot be generated.");
  else {
    const missing = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !modules.some((m) => m.number === n));
    if (missing.length) warnings.push(`Modules not found: ${missing.join(", ")}.`);
    for (const c of new Set(modules.flatMap((m) => m.courseOutcomes))) if (known.size && !known.has(c)) warnings.push(`Module references ${c}, which is not in the outcomes list.`);
  }
  const poCodes = new Set(programOutcomes.map((p) => p.code));
  for (const co of courseOutcomes) if (poCodes.size) co.programOutcomes = co.programOutcomes.filter((p) => poCodes.has(p));
  courseOutcomes = courseOutcomes.map((c) => ({ ...c }));
  if (gradingPolicy.source === "default") warnings.push("Grading weights not found; the USA CLASE standard (67% lecture / 33% lab) was assumed.");

  const syllabus: Syllabus = {
    courseCode: header.courseCode || "UNKNOWN",
    courseTitle: header.courseTitle || "Untitled course",
    term: header.term,
    programOutcomes, courseOutcomes, modules, gradingPolicy,
  };
  return { syllabus, warnings };
}

// ------------------------------------------------------------------ PDF → text

interface PdfTextItem { str: string; transform: number[]; width: number; hasEOL?: boolean }
interface PdfJsLike {
  getDocument: (src: { data: Uint8Array; useWorkerFetch?: boolean; isEvalSupported?: boolean; useSystemFonts?: boolean }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>; destroy?: () => Promise<void> }> };
  GlobalWorkerOptions?: { workerSrc: string };
}

let browserPdfJs: Promise<PdfJsLike> | null = null;
/** Browser loader: pdfjs-dist with its worker bundled by Next as a static asset. */
async function loadBrowserPdfJs(): Promise<PdfJsLike> {
  browserPdfJs ??= (async () => {
    const mod = (await import("pdfjs-dist")) as unknown as PdfJsLike;
    if (mod.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return mod;
  })();
  return browserPdfJs;
}

/**
 * Rebuild visual lines: items with (almost) the same baseline form one line, ordered by x; a
 * horizontal gap wider than ~1.5 em becomes " | " (a table-cell boundary).
 */
export function itemsToLines(items: PdfTextItem[]): string[] {
  const rows: { y: number; items: PdfTextItem[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = it.transform[5];
    const row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (row) row.items.push(it); else rows.push({ y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let line = "";
    let prevEnd = 0;
    sorted.forEach((it, i) => {
      const size = Math.abs(it.transform[0]) || 10;
      const gap = it.transform[4] - prevEnd;
      if (i > 0) line += gap > size * 1.5 ? " | " : gap > size * 0.15 || /\s$/.test(line) ? " " : "";
      line += it.str.trim();
      prevEnd = it.transform[4] + it.width;
    });
    return line;
  });
}

export async function extractPdfText(data: ArrayBuffer | Uint8Array, loader: () => Promise<PdfJsLike> = loadBrowserPdfJs): Promise<string> {
  const pdfjs = await loader();
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(itemsToLines(content.items.filter((i): i is PdfTextItem => typeof (i as PdfTextItem).str === "string")).join("\n"));
  }
  await doc.destroy?.();
  return pages.join("\n");
}

export async function parseSyllabusPdf(data: ArrayBuffer | Uint8Array, loader?: () => Promise<PdfJsLike>): Promise<ParseResult> {
  return parseSyllabusText(await extractPdfText(data, loader));
}
