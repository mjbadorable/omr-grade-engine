/**
 * Seeded class simulator (2-parameter logistic IRT model) producing scanner-shaped inputs.
 * Used by the benchmark/tests and by the dashboard's "demo class" button.
 *
 *   P(correct | θ) = 1 / (1 + e^(−a(θ − b)))     θ ~ N(0,1), a ∈ [aMin, aMax], b ∈ [−1.6, 1.6]
 * Wrong answers pick a distractor; `trap` items make one distractor attract strong students
 * (to exercise miskey detection).
 */
import type { DecodedFields } from "@/lib/vision/types";
import type { AnswerKey, ScanInput } from "./types";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  students: number;
  seed?: number;
  omitRate?: number;
  aMin?: number;
  aMax?: number;
  /** master question numbers whose key is "wrong": strong students pick option `trapOption` */
  traps?: Record<number, number>;
  /** fraction of sheets with an uncertain (partial) mark on one question */
  uncertainRate?: number;
  /** every student answers every question correctly (set-mapping checks) */
  perfect?: boolean;
}

export interface SimItem { a: number; b: number }

export function simulateClass(key: AnswerKey, o: SimOptions): { scans: ScanInput[]; items: Map<number, SimItem>; abilities: number[] } {
  const rnd = mulberry32(o.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const items = new Map<number, SimItem>();
  for (const r of key.questions.values()) items.set(r.questionNumber, { a: (o.aMin ?? 0.6) + rnd() * ((o.aMax ?? 2.2) - (o.aMin ?? 0.6)), b: -1.6 + rnd() * 3.2 });
  const sets = Object.keys(key.sets);
  const abilities: number[] = [];
  const scans: ScanInput[] = [];

  for (let s = 0; s < o.students; s++) {
    const theta = gauss();
    abilities.push(theta);
    const set = sets.length ? sets[s % sets.length] : null;
    const mapping = set ? key.sets[set] : {};
    const masterToPrinted = new Map<number, number>();
    (mapping.questionOrder ?? []).forEach((m, i) => { if (m) masterToPrinted.set(m, i + 1); });
    const answers: DecodedFields["answers"] = [];
    const numeric: DecodedFields["numeric"] = [];
    const uncertainQ = rnd() < (o.uncertainRate ?? 0) ? 1 + Math.floor(rnd() * key.questions.size) : -1;

    for (const r of key.questions.values()) {
      const it = items.get(r.questionNumber)!;
      const printed = masterToPrinted.get(r.questionNumber) ?? r.questionNumber;
      const omit = !o.perfect && rnd() < (o.omitRate ?? 0.03);
      const pCorrect = 1 / (1 + Math.exp(-it.a * (theta - it.b)));
      const ok = o.perfect || rnd() < pCorrect;
      if (r.type === "choice") {
        let masterChoice: number[] = [];
        if (!omit) {
          const trap = o.traps?.[r.questionNumber];
          if (trap !== undefined) masterChoice = ok ? [trap] : [r.correct[0] ?? 0];      // strong students pick the "trap"
          else if (ok) masterChoice = r.correct.length ? [...r.correct] : [0];
          else {
            const wrong = Array.from({ length: r.optionCount }, (_, i) => i).filter((i) => !r.correct.includes(i));
            masterChoice = [wrong[Math.floor(rnd() * wrong.length)] ?? 0];
          }
        }
        // master → printed option indices (inverse permutation)
        const perm = mapping.optionPermutations?.[r.questionNumber];
        const printedChoice = masterChoice.map((m) => (perm ? perm.indexOf(m) : m)).sort((x, y) => x - y);
        answers.push({ questionNumber: printed, marked: printedChoice, labels: printedChoice.map((i) => r.optionLabels[i]), uncertain: r.questionNumber === uncertainQ });
      } else if (r.type === "numeric") {
        numeric.push({ questionNumber: printed, value: omit ? null : ok ? String(r.value ?? 0) : String((r.value ?? 0) + 1 + Math.floor(rnd() * 9)), uncertain: false });
      }
    }
    answers.sort((x, y) => x.questionNumber - y.questionNumber);
    const roll = String(100000 + s);
    scans.push({
      sheetId: `sim-${roll}`,
      fields: { rollNumber: roll, rollDigits: [...roll], examSet: set, answers, numeric, matrix: [], conflicts: [] },
    });
  }
  return { scans, items, abilities };
}

/** A fully keyed synthetic answer key (choice questions) for benchmarks and demos. */
export function syntheticKey(questions: number, opts: { options?: number; seed?: number; sets?: string[]; shuffle?: boolean } = {}): AnswerKey {
  const rnd = mulberry32(opts.seed ?? 9);
  const n = opts.options ?? 4;
  const labels = "ABCDEFGHIJ".slice(0, n).split("");
  const qs = new Map(Array.from({ length: questions }, (_, i) => {
    const q = i + 1;
    return [q, { type: "choice" as const, questionNumber: q, optionCount: n, optionLabels: labels, correct: [Math.floor(rnd() * n)], mode: "ALL_MATCH" as const, points: 4, negative: 1, bonus: false, dropped: false, tags: { subject: ["Math", "Science", "English"][i % 3] } }];
  }));
  const sets: Record<string, AnswerKey["sets"][string]> = {};
  for (const [si, s] of (opts.sets ?? []).entries()) {
    if (!opts.shuffle || si === 0) { sets[s] = {}; continue; }
    const order = Array.from({ length: questions }, (_, i) => i + 1);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const optionPermutations: Record<number, number[]> = {};
    for (let q = 1; q <= questions; q++) {
      const p = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
      optionPermutations[q] = p;
    }
    sets[s] = { questionOrder: order, optionPermutations };
  }
  return { examId: "synthetic", version: 1, questions: qs, sets, defaultSet: opts.sets?.[0] ?? null, gradeBands: [{ minPercent: 0, label: "F" }, { minPercent: 50, label: "C" }, { minPercent: 75, label: "B" }, { minPercent: 90, label: "A" }], conflictPolicy: "zero" };
}
