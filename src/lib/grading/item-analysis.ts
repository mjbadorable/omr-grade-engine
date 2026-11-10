/**
 * Classical test theory item analysis over ScoredSheets.
 *
 *   p (difficulty)      = N_correct / N
 *   D (discrimination)  = p_upper − p_lower, upper/lower = top/bottom 27 % by total score
 *   r_pbis              = (M₁ − M₀) / σ · √(p·q)   (σ = population SD of total score)
 *   r_pbis (corrected)  = same, using the rest score (total − item points earned)
 *   KR-20               = K/(K−1) · (1 − Σ pᵢqᵢ / σ²),  on dichotomous item scores (0/1)
 *
 * Items are dichotomised as "CORRECT" vs anything else. Dropped, bonus and unkeyed
 * questions are excluded. Ties in the 27 % split are broken by sheetId so results are
 * deterministic.
 */
import { isKeyed } from "./answer-key";
import type { AnswerKey, DistractorStat, ItemFlag, ItemQuality, ItemStatistics, PsychometricReport, ScoredSheet } from "./types";

export const ANALYSIS = {
  GROUP_FRACTION: 0.27,
  STRONG_D: 0.3,
  POOR_D: 0.2,
  TOO_EASY_P: 0.9,
  TOO_HARD_P: 0.2,
  NON_FUNCTIONAL_SHARE: 0.05,
} as const;

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function meanSd(xs: number[]) {
  const n = xs.length;
  if (!n) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const varP = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(varP) };
}

/** Point-biserial between a 0/1 item vector and a continuous score vector (population SD). */
export function pointBiserial(item: readonly number[], score: readonly number[]): number | null {
  const n = item.length;
  let n1 = 0, s1 = 0, s0 = 0;
  for (let i = 0; i < n; i++) { if (item[i]) { n1++; s1 += score[i]; } else s0 += score[i]; }
  const n0 = n - n1;
  if (!n1 || !n0) return null;
  const { sd } = meanSd([...score]);
  if (sd === 0) return null;
  const p = n1 / n;
  return ((s1 / n1 - s0 / n0) / sd) * Math.sqrt(p * (1 - p));
}

export function kr20(itemMatrix: readonly (readonly number[])[]): number | null {
  // itemMatrix[student][item] ∈ {0,1}
  const n = itemMatrix.length;
  const k = n ? itemMatrix[0].length : 0;
  if (n < 2 || k < 2) return null;
  const totals = itemMatrix.map((row) => row.reduce((a, b) => a + b, 0));
  const { sd } = meanSd(totals);
  const variance = sd * sd;
  if (variance === 0) return null;
  let pq = 0;
  for (let j = 0; j < k; j++) {
    let c = 0;
    for (let i = 0; i < n; i++) c += itemMatrix[i][j];
    const p = c / n;
    pq += p * (1 - p);
  }
  return (k / (k - 1)) * (1 - pq / variance);
}

export function classifyItem(s: Pick<ItemStatistics, "d" | "p" | "rpbisCorrected">, miskey: boolean): { quality: ItemQuality; flags: ItemFlag[] } {
  const flags: ItemFlag[] = [];
  if (s.d < 0 || (s.rpbisCorrected !== null && s.rpbisCorrected < 0)) flags.push("NEGATIVE_DISCRIMINATION");
  else if (s.d < ANALYSIS.POOR_D) flags.push("LOW_DISCRIMINATION");
  if (miskey) flags.push("POSSIBLE_MISKEY");
  if (s.p > ANALYSIS.TOO_EASY_P) flags.push("TOO_EASY");
  if (s.p < ANALYSIS.TOO_HARD_P) flags.push("TOO_HARD");
  const poor = s.d < ANALYSIS.POOR_D || miskey || flags.includes("NEGATIVE_DISCRIMINATION");
  return { quality: poor ? "POOR" : s.d >= ANALYSIS.STRONG_D ? "STRONG" : "AVERAGE", flags };
}

export function analyzeItems(sheets: readonly ScoredSheet[], key: AnswerKey): PsychometricReport {
  const n = sheets.length;
  const rules = [...key.questions.values()].filter((r) => !r.dropped && !r.bonus && isKeyed(r));
  const qIndex = new Map(rules.map((r, j) => [r.questionNumber, j]));

  // dichotomous matrix + earned points per item
  const X: number[][] = sheets.map(() => new Array(rules.length).fill(0));
  const earned: number[][] = sheets.map(() => new Array(rules.length).fill(0));
  const chosen: number[][][] = sheets.map(() => rules.map(() => [] as number[]));
  const omittedCount = new Array(rules.length).fill(0);
  sheets.forEach((s, i) => {
    for (const it of s.items) {
      const j = qIndex.get(it.questionNumber);
      if (j === undefined) continue;
      X[i][j] = it.status === "CORRECT" ? 1 : 0;
      earned[i][j] = it.scoreEarned;
      chosen[i][j] = it.selected;
      if (it.status === "OMITTED") omittedCount[j]++;
    }
  });
  const totals = sheets.map((s) => s.totalScore);
  const { mean, sd } = meanSd(totals);
  const sorted = [...totals].sort((a, b) => a - b);
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;

  // 27 % groups (deterministic tie-break on sheetId)
  const order = sheets.map((s, i) => i).sort((a, b) => totals[b] - totals[a] || sheets[a].sheetId.localeCompare(sheets[b].sheetId));
  const g = n ? Math.max(1, Math.round(ANALYSIS.GROUP_FRACTION * n)) : 0;
  const upper = new Set(order.slice(0, g));
  const lower = new Set(order.slice(Math.max(g, n - g)));

  const items: ItemStatistics[] = rules.map((rule, j) => {
    let correct = 0, cu = 0, cl = 0;
    const omitted = omittedCount[j];
    for (let i = 0; i < n; i++) {
      correct += X[i][j];
      if (upper.has(i)) cu += X[i][j];
      if (lower.has(i)) cl += X[i][j];
    }
    const p = n ? correct / n : 0;
    const pUpper = upper.size ? cu / upper.size : 0;
    const pLower = lower.size ? cl / lower.size : 0;
    const item = X.map((row) => row[j]);
    const rest = totals.map((t, i) => t - earned[i][j]);

    // distractors (choice items only)
    const distractors: DistractorStat[] = [];
    let miskey = false;
    if (rule.type === "choice") {
      for (let o = 0; o < rule.optionCount; o++) {
        let count = 0, up = 0, lo = 0;
        for (let i = 0; i < n; i++) {
          if (!chosen[i][j].includes(o)) continue;
          count++;
          if (upper.has(i)) up++;
          if (lower.has(i)) lo++;
        }
        const isKey = rule.correct.includes(o);
        const upP = upper.size ? up / upper.size : 0, loP = lower.size ? lo / lower.size : 0;
        const flag = isKey ? null
          : n && count / n < ANALYSIS.NON_FUNCTIONAL_SHARE ? "NON_FUNCTIONAL"
          : upP > loP ? "MISLEADING" : null;
        distractors.push({ optionIndex: o, label: rule.optionLabels[o] ?? String(o), isKey, count, upper: up, lower: lo, proportion: round(n ? count / n : 0), upperProportion: round(upP), lowerProportion: round(loP), flag });
      }
      // miskey: a wrong option attracts the strong students more than the keyed answer does
      const keyUpper = Math.max(0, ...distractors.filter((d) => d.isKey).map((d) => d.upperProportion));
      miskey = distractors.some((d) => !d.isKey && d.upperProportion > keyUpper && d.upperProportion > d.lowerProportion);
    }

    const base = {
      questionNumber: rule.questionNumber, type: rule.type, n, correct,
      p: round(p), pUpper: round(pUpper), pLower: round(pLower), d: round(pUpper - pLower),
      rpbis: nullableRound(pointBiserial(item, totals)),
      rpbisCorrected: nullableRound(pointBiserial(item, rest)),
      omitted, distractors,
    };
    return { ...base, ...classifyItem(base, miskey) };
  });

  const k = rules.length;
  const r = kr20(X);
  const dich = meanSd(X.map((row) => row.reduce((a, b) => a + b, 0)));
  return {
    keyVersion: key.version, n, k, groupSize: g,
    mean: round(mean), sd: round(sd), median: round(median),
    min: n ? sorted[0] : 0, max: n ? sorted[n - 1] : 0,
    kr20: nullableRound(r),
    sem: r === null ? null : round(dich.sd * Math.sqrt(Math.max(0, 1 - r))),
    items,
  };
}

const nullableRound = (v: number | null) => (v === null ? null : round(v));
