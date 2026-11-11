/**
 * Answer-key construction, immutable updates and a validated JSON codec.
 * `questions` is a Map in memory; on the wire it is an array of rules.
 */
import { z } from "zod";
import type { OMRTemplate } from "@/lib/omr/schema";
import type { DecodedFields } from "@/lib/vision/types";
import type { AnswerKey, GradeBand, QuestionRule, SetMapping } from "./types";

export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { minPercent: 90, label: "A" },
  { minPercent: 80, label: "B" },
  { minPercent: 70, label: "C" },
  { minPercent: 60, label: "D" },
  { minPercent: 0, label: "F" },
];

export function isKeyed(r: QuestionRule): boolean {
  if (r.type === "choice") return r.correct.length > 0;
  if (r.type === "numeric") return r.value !== null && Number.isFinite(r.value);
  return Object.values(r.rows).some((c) => c.length > 0);
}

/** Blank key with one rule per question in the template (nothing marked correct yet). */
export function keyFromTemplate(t: OMRTemplate, examId = t.templateId): AnswerKey {
  const questions = new Map<number, QuestionRule>();
  const base = { points: 1, negative: 0, bonus: false, dropped: false };
  for (const page of t.pages) {
    for (const r of page.regions) {
      if (r.kind === "mcq") {
        for (const q of r.questions) {
          questions.set(q.number, { ...base, type: "choice", questionNumber: q.number, optionCount: q.options.length, optionLabels: q.options, correct: [], mode: "ALL_MATCH", tags: { section: r.sectionId } });
        }
      } else if (r.kind === "numeric") {
        questions.set(r.questionNumber, { ...base, type: "numeric", questionNumber: r.questionNumber, value: null, tolerance: 0, tags: { section: r.sectionId } });
      } else if (r.kind === "matrix") {
        questions.set(r.questionNumber, { ...base, type: "matrix", questionNumber: r.questionNumber, rows: Object.fromEntries(r.rows.map((x) => [x, [] as string[]])), mode: "ALL_MATCH", tags: { section: r.sectionId } });
      }
    }
  }
  const setRegion = t.pages[0].regions.find((r) => r.kind === "set");
  const sets: Record<string, SetMapping> = {};
  if (setRegion && setRegion.kind === "set") for (const o of setRegion.options) sets[o] = {};
  return {
    examId, version: 1, layoutHash: t.layoutHash, questions: sortMap(questions), sets,
    defaultSet: setRegion && setRegion.kind === "set" ? setRegion.options[0] : null,
    gradeBands: DEFAULT_GRADE_BANDS, conflictPolicy: "zero",
  };
}

const sortMap = (m: Map<number, QuestionRule>) => new Map([...m.entries()].sort((a, b) => a[0] - b[0]));

/** Immutable rule update; every change bumps the key version. */
export function updateRule(key: AnswerKey, questionNumber: number, patch: Partial<QuestionRule>): AnswerKey {
  const cur = key.questions.get(questionNumber);
  if (!cur) throw new Error(`question ${questionNumber} is not in the key`);
  const next = new Map(key.questions);
  next.set(questionNumber, { ...cur, ...patch, type: cur.type, questionNumber } as QuestionRule);
  return { ...key, questions: next, version: key.version + 1 };
}

export function updateKey(key: AnswerKey, patch: Partial<Omit<AnswerKey, "questions" | "version">>): AnswerKey {
  return { ...key, ...patch, version: key.version + 1 };
}

/** Apply the same patch to many rules in one version step (e.g. "+4 / −1 for all"). */
export function updateAllRules(key: AnswerKey, patch: Partial<Pick<QuestionRule, "points" | "negative">>, filter: (r: QuestionRule) => boolean = () => true): AnswerKey {
  const next = new Map(key.questions);
  for (const [n, r] of next) if (filter(r)) next.set(n, { ...r, ...patch } as QuestionRule);
  return { ...key, questions: next, version: key.version + 1 };
}

/**
 * Teacher shortcut: take the answers from a scanned master sheet (Set A / default set) as the key.
 * Only answered questions are changed.
 */
export function keyFromScannedAnswers(key: AnswerKey, fields: DecodedFields): AnswerKey {
  const next = new Map(key.questions);
  for (const a of fields.answers) {
    const r = next.get(a.questionNumber);
    if (r?.type === "choice" && a.marked.length) next.set(a.questionNumber, { ...r, correct: [...a.marked].sort((x, y) => x - y) });
  }
  for (const nAns of fields.numeric) {
    const r = next.get(nAns.questionNumber);
    if (r?.type === "numeric" && nAns.value !== null) next.set(nAns.questionNumber, { ...r, value: Number(nAns.value) });
  }
  for (const m of fields.matrix) {
    const r = next.get(m.questionNumber);
    if (r?.type === "matrix" && Object.values(m.rows).some((c) => c.length)) next.set(m.questionNumber, { ...r, rows: m.rows });
  }
  return { ...key, questions: next, version: key.version + 1 };
}

// ------------------------------------------------------------------ set mapping text format
/**
 * One line per printed question: `printed:master[:PERM]`, e.g. `1:5:BADC` means printed Q1 is
 * master Q5 and printed options A,B,C,D are master options B,A,D,C. Blank lines and `#` comments ignored.
 */
export function parseSetMappingText(text: string, key: AnswerKey): { mapping: SetMapping; errors: string[] } {
  const errors: string[] = [];
  const order: number[] = [];
  const perms: Record<number, number[]> = {};
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const m = /^(\d+)\s*:\s*(\d+)(?:\s*:\s*([A-Za-z]+))?$/.exec(line);
    if (!m) { errors.push(`line ${i + 1}: expected printed:master[:PERM]`); return; }
    const printed = +m[1], master = +m[2];
    const rule = key.questions.get(master);
    if (!rule) { errors.push(`line ${i + 1}: master question ${master} does not exist`); return; }
    order[printed - 1] = master;
    if (m[3]) {
      if (rule.type !== "choice") { errors.push(`line ${i + 1}: option shuffle only applies to multiple-choice questions`); return; }
      const perm = [...m[3].toUpperCase()].map((c) => c.charCodeAt(0) - 65);
      const ok = perm.length === rule.optionCount && new Set(perm).size === perm.length && perm.every((p) => p >= 0 && p < rule.optionCount);
      if (!ok) errors.push(`line ${i + 1}: permutation must use each of ${rule.optionLabels.join("")} once`);
      else perms[master] = perm;
    }
  });
  const used = order.filter((x) => x !== undefined);
  if (new Set(used).size !== used.length) errors.push("a master question is mapped twice");
  const mapping: SetMapping = {};
  if (order.length) mapping.questionOrder = Array.from({ length: order.length }, (_, i) => order[i] ?? 0);
  if (Object.keys(perms).length) mapping.optionPermutations = perms;
  return { mapping, errors };
}

export function formatSetMappingText(m: SetMapping): string {
  const lines: string[] = [];
  const order = m.questionOrder ?? [];
  const permFor = (master: number) => {
    const p = m.optionPermutations?.[master];
    return p ? `:${p.map((x) => String.fromCharCode(65 + x)).join("")}` : "";
  };
  order.forEach((master, i) => { if (master) lines.push(`${i + 1}:${master}${permFor(master)}`); });
  if (!order.length) for (const k of Object.keys(m.optionPermutations ?? {})) lines.push(`${k}:${k}${permFor(+k)}`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ JSON codec
const tags = z.object({ subject: z.string().optional(), section: z.string().optional() });
const base = { questionNumber: z.number().int().positive(), points: z.number().min(0), negative: z.number().min(0), bonus: z.boolean(), dropped: z.boolean(), tags, outcomeCode: z.string().optional(), moduleNumber: z.number().int().positive().optional() };
const RuleSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("choice"), optionCount: z.number().int().min(2).max(10), optionLabels: z.array(z.string()), correct: z.array(z.number().int().nonnegative()), mode: z.enum(["ALL_MATCH", "ANY_MATCH", "PARTIAL_CREDIT"]) }),
  z.object({ ...base, type: z.literal("numeric"), value: z.number().nullable(), tolerance: z.number().min(0) }),
  z.object({ ...base, type: z.literal("matrix"), rows: z.record(z.array(z.string())), mode: z.enum(["ALL_MATCH", "PARTIAL_CREDIT"]) }),
]);
const SetMappingSchema = z.object({ questionOrder: z.array(z.number().int().nonnegative()).optional(), optionPermutations: z.record(z.array(z.number().int().nonnegative())).optional() });
export const AnswerKeyJsonSchema = z.object({
  schema: z.literal("omr-answer-key/v1"),
  examId: z.string(),
  version: z.number().int().positive(),
  layoutHash: z.string().optional(),
  questions: z.array(RuleSchema),
  sets: z.record(SetMappingSchema),
  defaultSet: z.string().nullable(),
  gradeBands: z.array(z.object({ minPercent: z.number(), label: z.string() })),
  conflictPolicy: z.enum(["zero", "score-filled"]),
});
export type AnswerKeyJson = z.infer<typeof AnswerKeyJsonSchema>;

export function serializeKey(k: AnswerKey): AnswerKeyJson {
  return { schema: "omr-answer-key/v1", ...k, questions: [...k.questions.values()], sets: { ...k.sets }, gradeBands: [...k.gradeBands] } as AnswerKeyJson;
}

export function parseKey(json: unknown): AnswerKey {
  const j = AnswerKeyJsonSchema.parse(json);
  const questions = sortMap(new Map(j.questions.map((r) => [r.questionNumber, r as QuestionRule])));
  const sets: Record<string, SetMapping> = {};
  for (const [label, m] of Object.entries(j.sets)) {
    sets[label] = {
      ...(m.questionOrder ? { questionOrder: m.questionOrder } : {}),
      ...(m.optionPermutations ? { optionPermutations: Object.fromEntries(Object.entries(m.optionPermutations).map(([q, p]) => [Number(q), p])) } : {}),
    };
  }
  return { examId: j.examId, version: j.version, layoutHash: j.layoutHash, questions, sets, defaultSet: j.defaultSet, gradeBands: j.gradeBands, conflictPolicy: j.conflictPolicy };
}
