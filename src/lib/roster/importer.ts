/**
 * CSV roster import: RFC-4180 parsing (quotes, embedded commas/newlines, BOM), delimiter
 * sniffing (comma / semicolon / tab), header alias detection, sanitisation and duplicates.
 */
import { rollKey, type Roster, type Student } from "./schema";

export type RosterField = "rollNumber" | "name" | "firstName" | "lastName" | "section" | "email" | "phone" | "guardianContact";
export type ColumnMapping = Partial<Record<RosterField, number>>;

/** Normalised header (lowercase, alphanumerics only) → field. */
const ALIASES: Record<RosterField, string[]> = {
  rollNumber: ["roll", "rollno", "rollnumber", "rollnum", "studentid", "studentno", "studentnumber", "id", "idno", "idnumber", "lrn", "learnerreferencenumber", "admissionno", "admissionnumber", "regno", "registrationno", "registrationnumber", "indexno", "indexnumber", "seatno", "enrollmentno", "enrolmentno"],
  name: ["name", "fullname", "studentname", "learnername", "nameofstudent", "completename"],
  firstName: ["firstname", "givenname", "fname", "first"],
  lastName: ["lastname", "surname", "familyname", "lname", "last"],
  section: ["section", "class", "classsection", "gradesection", "grade", "group", "batch", "division", "homeroom"],
  email: ["email", "emailaddress", "mail", "studentemail"],
  phone: ["phone", "phoneno", "phonenumber", "mobile", "mobileno", "mobilenumber", "contact", "contactno", "contactnumber", "cellphone"],
  guardianContact: ["guardian", "guardiancontact", "guardianphone", "guardianmobile", "guardianemail", "parent", "parentcontact", "parentphone", "parentmobile", "parentemail", "emergencycontact"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function sniffDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(text: string, delimiter = sniffDelimiter(text)): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

/** Map headers to fields. Exact alias matches win over substring matches; each column is used once. */
export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const hs = headers.map(norm);
  const fields = Object.keys(ALIASES) as RosterField[];
  for (const pass of ["exact", "contains"] as const) {
    for (const f of fields) {
      if (mapping[f] !== undefined) continue;
      const idx = hs.findIndex((h, i) => !used.has(i) && h !== "" && ALIASES[f].some((a) => (pass === "exact" ? h === a : a.length > 3 && h.includes(a))));
      if (idx >= 0) { mapping[f] = idx; used.add(idx); }
    }
  }
  // "contact" alone is a phone column, but "guardian contact" was already claimed above.
  return mapping;
}

export type ImportIssueCode = "MISSING_ROLL" | "MISSING_NAME" | "DUPLICATE_ROLL" | "INVALID_EMAIL" | "NO_ROLL_COLUMN" | "NO_NAME_COLUMN";
export interface ImportIssue { row: number; code: ImportIssueCode; message: string }

export interface ImportResult {
  roster: Roster;
  mapping: ColumnMapping;
  headers: string[];
  issues: ImportIssue[];
  /** rows skipped because their roll number repeats an earlier row */
  duplicates: { row: number; rollNumber: string; firstRow: number }[];
}

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function importRoster(text: string, opts: { name?: string; mapping?: ColumnMapping; now?: number } = {}): ImportResult {
  const rows = parseCsv(text);
  const headers = (rows[0] ?? []).map((h) => clean(h));
  const mapping = { ...detectColumns(headers), ...opts.mapping };
  const issues: ImportIssue[] = [];
  const duplicates: ImportResult["duplicates"] = [];
  const students: Student[] = [];
  const seen = new Map<string, number>();

  if (mapping.rollNumber === undefined) issues.push({ row: 1, code: "NO_ROLL_COLUMN", message: "No roll-number column found (looked for Roll No, Student ID, LRN, …)" });
  if (mapping.name === undefined && mapping.firstName === undefined && mapping.lastName === undefined)
    issues.push({ row: 1, code: "NO_NAME_COLUMN", message: "No name column found (looked for Name, Full Name, First/Last Name, …)" });

  if (mapping.rollNumber !== undefined) {
    rows.slice(1).forEach((r, i) => {
      const rowNo = i + 2;
      const get = (f: RosterField) => (mapping[f] === undefined ? "" : clean(r[mapping[f]!]));
      const roll = get("rollNumber").replace(/\s+/g, "");
      const name = get("name") || [get("firstName"), get("lastName")].filter(Boolean).join(" ");
      if (!roll) { issues.push({ row: rowNo, code: "MISSING_ROLL", message: `Row ${rowNo}: no roll number` }); return; }
      const key = rollKey(roll)!;
      if (seen.has(key)) {
        duplicates.push({ row: rowNo, rollNumber: roll, firstRow: seen.get(key)! });
        issues.push({ row: rowNo, code: "DUPLICATE_ROLL", message: `Row ${rowNo}: roll ${roll} already used on row ${seen.get(key)}` });
        return;
      }
      seen.set(key, rowNo);
      if (!name) issues.push({ row: rowNo, code: "MISSING_NAME", message: `Row ${rowNo}: roll ${roll} has no name` });
      const email = get("email");
      if (email && !EMAIL.test(email)) issues.push({ row: rowNo, code: "INVALID_EMAIL", message: `Row ${rowNo}: "${email}" is not an email address` });
      const s: Student = { rollNumber: roll, name: name || `Student ${roll}` };
      const section = get("section"), phone = get("phone"), guardian = get("guardianContact");
      if (section) s.section = section;
      if (email && EMAIL.test(email)) s.email = email.toLowerCase();
      if (phone) s.phone = phone;
      if (guardian) s.guardianContact = guardian;
      students.push(s);
    });
  }
  return {
    roster: { schema: "omr-roster/v1", name: opts.name ?? "Class roster", importedAt: opts.now ?? Date.now(), students },
    mapping, headers, issues, duplicates,
  };
}

export function rosterToCsv(r: Roster): string {
  const esc = (v?: string) => (v === undefined ? "" : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["Roll No,Full Name,Section,Email,Phone,Guardian Contact", ...r.students.map((s) =>
    [s.rollNumber, s.name, s.section, s.email, s.phone, s.guardianContact].map(esc).join(","))].join("\r\n") + "\r\n";
}
