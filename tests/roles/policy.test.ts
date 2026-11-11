import { describe, expect, it } from "vitest";
import { AUDIT_KINDS, describeKeyChange, searchAudit, type AuditEntry } from "@/lib/admin/audit";
import { CLASE_FORMULA, emailAllowedByPolicy, labGrade, lectureGrade, normalizeDomains, termGrade, validateFormula } from "@/lib/admin/formula";
import { ACTIONS, type Action, can, checkRoleChange, isAdmin, ROLES } from "@/lib/roles/policy";

describe("role matrix", () => {
  const FACULTY: Action[] = ["analytics.view", "syllabus.view", "syllabus.drop", "exam.create", "key.edit", "scan.submit", "grade.override", "conflict.resolve", "roster.import"];
  const GOVERNANCE: Action[] = ["admin.portal", "syllabus.delete", "faculty.manage", "policy.edit", "audit.view", "exam.close"];

  it("teachers get every faculty action and no governance action", () => {
    for (const a of FACULTY) expect(can("teacher", a), a).toBe(true);
    for (const a of GOVERNANCE) expect(can("teacher", a), a).toBe(false);
    expect(isAdmin("teacher")).toBe(false);
  });

  it("admins and owners get everything", () => {
    for (const role of ["admin", "owner"] as const) for (const a of Object.keys(ACTIONS) as Action[]) expect(can(role, a)).toBe(true);
    expect(isAdmin("admin") && isAdmin("owner")).toBe(true);
  });

  it("viewers are read-only; signed-out / unknown have nothing", () => {
    expect(can("viewer", "analytics.view")).toBe(true);
    expect(can("viewer", "syllabus.view")).toBe(true);
    for (const a of [...FACULTY.filter((x) => !x.endsWith(".view")), ...GOVERNANCE]) expect(can("viewer", a), a).toBe(false);
    expect(can(null, "analytics.view")).toBe(false);
    expect(can(undefined, "admin.portal")).toBe(false);
  });

  it("every action is covered by the matrix above", () => {
    expect([...FACULTY, ...GOVERNANCE].sort()).toEqual(Object.keys(ACTIONS).sort());
    expect(ROLES).toEqual(["viewer", "teacher", "admin", "owner"]);
  });
});

describe("checkRoleChange", () => {
  const base = { actor: "admin", actorId: "a", target: "teacher", targetId: "t", next: "admin" } as const;
  it("lets an admin elevate teacher → admin and demote back", () => {
    expect(checkRoleChange(base).ok).toBe(true);
    expect(checkRoleChange({ ...base, target: "admin", next: "teacher" }).ok).toBe(true);
  });
  it.each([
    [{ actor: "teacher" }, "FORBIDDEN"],
    [{ actor: "viewer" }, "FORBIDDEN"],
    [{ targetId: "a" }, "SELF_CHANGE"],
    [{ target: "owner", next: "teacher" }, "OWNER_PROTECTED"],
    [{ next: "owner" }, "INVALID_ROLE"],
  ] as const)("rejects %j with %s", (patch, code) => {
    const d = checkRoleChange({ ...base, ...patch });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe(code);
  });
});

describe("USA CLASE grading formula", () => {
  it("is 67% lecture + 33% lab, major exam 50% of lecture, lab exam 30% of lab", () => {
    expect(CLASE_FORMULA).toEqual({ lectureWeight: 67, labWeight: 33, lectureMajorExamWeight: 50, labExamWeight: 30 });
    expect(validateFormula(CLASE_FORMULA)).toEqual([]);
    expect(termGrade(90, 80)).toBe(86.7);          // 0.67·90 + 0.33·80
    expect(lectureGrade(80, 100)).toBe(90);        // 0.5·80 + 0.5·100
    expect(labGrade(100, 50)).toBe(65);            // 0.3·100 + 0.7·50
    expect(termGrade(lectureGrade(80, 100), labGrade(100, 50))).toBe(81.75);
  });
  it("rejects formulas that do not add up or are out of range", () => {
    expect(validateFormula({ ...CLASE_FORMULA, labWeight: 40 })[0]).toMatch(/add up to 100/);
    expect(validateFormula({ ...CLASE_FORMULA, labExamWeight: 140 })[0]).toMatch(/between 0 and 100/);
  });
});

describe("domain policy", () => {
  it("normalises admin input and matches exact domains only", () => {
    expect(normalizeDomains([" @USA.edu.ph ", "usa.edu.ph", "not a domain", "x", "faculty.usa.edu.ph"])).toEqual(["usa.edu.ph", "faculty.usa.edu.ph"]);
    expect(emailAllowedByPolicy("a@usa.edu.ph", ["usa.edu.ph"])).toBe(true);
    expect(emailAllowedByPolicy("a@mail.usa.edu.ph", ["usa.edu.ph"])).toBe(false);
    expect(emailAllowedByPolicy("a@gmail.com", ["usa.edu.ph"])).toBe(false);
    expect(emailAllowedByPolicy("a@gmail.com", [])).toBe(true);        // empty policy = no extra restriction
    expect(emailAllowedByPolicy(null, ["usa.edu.ph"])).toBe(false);
  });
});

describe("audit trail search", () => {
  const e = (id: string, at: number, kind: AuditEntry["kind"], actorName: string, summary: string, extra: Partial<AuditEntry> = {}): AuditEntry =>
    ({ id, at, kind, actorId: actorName.toLowerCase(), actorName, actorEmail: `${actorName.toLowerCase()}@usa.edu.ph`, summary, ...extra });
  const rows = [
    e("1", 100, "KEY_UPDATE", "Ana", "Answer key v2: Q5 answer B→C", { examName: "IT 321 Prelim" }),
    e("2", 300, "GRADE_OVERRIDE", "Ben", "Q12 (answer) corrected on a scanned sheet", { examName: "IT 321 Prelim", detail: "reason: eraser smudge" }),
    e("3", 200, "CONFLICT_RESOLUTION", "Ana", "Duplicate roll 2301: kept one sheet", { examName: "IT 322 Midterm" }),
    e("4", 400, "ROLE_CHANGE", "Dean", "ben@usa.edu.ph role teacher → admin"),
  ];
  it("returns newest first and ANDs every search word across actor, exam, summary and detail", () => {
    expect(searchAudit(rows).map((r) => r.id)).toEqual(["4", "2", "3", "1"]);
    expect(searchAudit(rows, { query: "ana prelim" }).map((r) => r.id)).toEqual(["1"]);
    expect(searchAudit(rows, { query: "SMUDGE" }).map((r) => r.id)).toEqual(["2"]);
    expect(searchAudit(rows, { query: "nothing like this" })).toEqual([]);
  });
  it("filters by kind, actor and date range", () => {
    expect(searchAudit(rows, { kinds: ["KEY_UPDATE", "ROLE_CHANGE"] }).map((r) => r.id)).toEqual(["4", "1"]);
    expect(searchAudit(rows, { actor: "ana" }).map((r) => r.id)).toEqual(["3", "1"]);
    expect(searchAudit(rows, { from: 150, to: 350 }).map((r) => r.id)).toEqual(["2", "3"]);
    expect(AUDIT_KINDS).toContain("SYLLABUS_UPLOAD");
  });
  it("describes what changed between key versions", () => {
    const rule = (over: Record<string, unknown> = {}) => ({ type: "choice", points: 1, negative: 0, bonus: false, dropped: false, correct: [1], optionLabels: ["A", "B", "C", "D"], ...over });
    const v1 = { questions: { "1": rule(), "2": rule(), "3": rule() } };
    const v2 = { questions: { "1": rule({ correct: [2] }), "2": rule({ points: 2, negative: 0.25 }), "3": rule({ dropped: true, outcomeCode: "CO2" }) } };
    expect(describeKeyChange(v1, v2)).toBe("Q1 answer B→C; Q2 points 1→2; Q2 penalty 0→0.25; Q3 dropped; Q3 outcome -→CO2");
    expect(describeKeyChange(null, v1)).toBe("Initial answer key created");
    expect(describeKeyChange(v1, v1)).toMatch(/Key settings updated/);
    const many = { questions: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), rule({ correct: [3] })])) };
    const base = { questions: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), rule()])) };
    expect(describeKeyChange(base, many)).toMatch(/\+3 more$/);
  });
});
