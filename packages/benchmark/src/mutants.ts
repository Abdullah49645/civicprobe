import { Rational } from "../../shared/src/rational.js";
import { evaluateExact, rowFor } from "../../policy-engine/src/evaluate.js";
import type { ProgressiveSchedule, ScheduleRow } from "../../policy-engine/src/types.js";
import { computeScheduleDelta, parseRat } from "../../delta-engine/src/schedule-delta.js";
import { roundExact } from "../../comparator/src/compare.js";
import type { ComparisonConfig } from "../../shared/src/result.js";

/**
 * Mutation analysis for policy-update faults.
 *
 * A mutant is a plausible WRONG implementation of the NEW policy. Families:
 *  - partial-update: the deployment took some edits of the amendment but not
 *    others. Generated mechanically from the NEW table and the OLD table:
 *    each changed rate reverted alone, each changed fixed amount reverted
 *    alone, each changed row reverted whole, each new threshold missing, and
 *    the whole table stale.
 *  - legacy-branch: the withdrawn surcharge still applied (both ">" and "≥").
 *  - branch-typo: one row-selection comparison uses T ± w instead of T
 *    (w ∈ {100, 1,000, 10,000}) for every threshold T of the NEW table.
 *  - rounding: display truncates instead of rounding; display rounds to 10.
 *
 * Ground truth is computed, never assumed: for schedule-shaped mutants the
 * exact delta engine gives the region where mutant ≠ NEW; for typo mutants
 * the region is the mis-selected band. Each region is then scanned to find
 * where the difference is OBSERVABLE under the comparison config. A mutant
 * with no observable input is EQUIVALENT (undetectable by any strategy) and
 * is excluded from detection-rate denominators, as is standard.
 */

export type MutantFamily = "partial-update" | "legacy-branch" | "branch-typo" | "rounding" | "out-of-scope-typo";

export interface Mutant {
  id: string;
  family: MutantFamily;
  description: string;
  /** What the service displays for input x. */
  display: (x: number) => Rational;
  /** Candidate region where it may differ from NEW (half-open integer spans [lo, hi]). */
  suspect: { lo: number; hi: number }[];
}

export interface GroundTruth {
  equivalent: boolean;
  /** Smallest observably-failing input in [0, domainMax], or null. */
  minimalFailing: number | null;
  /** Number of failing integers found during the ground-truth scan (lower bound on the failing set size). */
  observedFailures: number;
}

const r = (n: number) => Rational.of(n);

function scheduleMutant(base: ProgressiveSchedule, rows: ScheduleRow[], surcharge: ProgressiveSchedule["surcharge"], opts: { surchargeInclusive?: boolean } = {}): (x: number) => Rational {
  const m: ProgressiveSchedule = { ...base, rows, surcharge };
  return (x: number) => {
    let t = evaluateExact({ ...m, surcharge: undefined }, x);
    if (surcharge) {
      const applies = opts.surchargeInclusive ? x >= surcharge.over : x > surcharge.over;
      if (applies) t = t.mul(Rational.ONE.add(Rational.parse(surcharge.rateOnTax)));
    }
    return t;
  };
}

export function generateMutants(oldP: ProgressiveSchedule, newP: ProgressiveSchedule, domainMax: number): Mutant[] {
  const out: Mutant[] = [];
  const whole = [{ lo: 0, hi: domainMax }];
  const regionOf = (m: ProgressiveSchedule): { lo: number; hi: number }[] =>
    computeScheduleDelta(newP, m).affected.map((iv) => ({
      lo: Number(parseRat(iv.lo).floor()) + (iv.loClosed ? 0 : 1),
      hi: iv.hi === null ? domainMax : Math.min(domainMax, Number(parseRat(iv.hi).floor())),
    })).filter((s) => s.lo <= s.hi);
  const push = (id: string, family: MutantFamily, description: string, rows: ScheduleRow[], surcharge?: ProgressiveSchedule["surcharge"], inclusive = false) => {
    const sched: ProgressiveSchedule = { ...newP, rows, surcharge };
    const suspect = inclusive && surcharge ? [...regionOf(sched), { lo: surcharge.over, hi: surcharge.over }] : regionOf(sched);
    out.push({ id, family, description, display: scheduleMutant(newP, rows, surcharge, { surchargeInclusive: inclusive }), suspect });
  };
  const oldRowAt = (x: number) => rowFor(oldP, r(x + 1));
  const oldTaxAt = (x: number) => evaluateExact({ ...oldP, surcharge: undefined }, x);

  // partial-update
  for (const nr of newP.rows) {
    const or = oldRowAt(nr.over);
    const oldBase = oldTaxAt(nr.over);
    const rateChanged = or.rate !== nr.rate;
    const baseChanged = !oldBase.eq(r(nr.base));
    const replace = (patch: Partial<ScheduleRow>) => newP.rows.map((x) => (x.row === nr.row ? { ...x, ...patch } : x));
    if (rateChanged) push(`stale-rate:${nr.row}`, "partial-update", `${nr.row} marginal rate left at ${or.rate} (fixed amount updated)`, replace({ rate: or.rate }));
    if (baseChanged && oldBase.isInteger()) push(`stale-base:${nr.row}`, "partial-update", `${nr.row} fixed amount left at ${oldBase.toDecimalString()} (rate updated)`, replace({ base: oldBase.toNumber() }));
    if (rateChanged && baseChanged && oldBase.isInteger()) push(`stale-row:${nr.row}`, "partial-update", `${nr.row} left entirely on the old formula`, replace({ rate: or.rate, base: oldBase.toNumber() }));
  }
  const oldUppers = new Set(oldP.rows.map((x) => x.upTo));
  for (let i = 1; i < newP.rows.length; i++) {
    const nr = newP.rows[i];
    if (oldUppers.has(nr.over)) continue;
    const prev = newP.rows[i - 1];
    const rows = newP.rows.filter((_, j) => j !== i).map((x) => (x.row === prev.row ? { ...x, upTo: nr.upTo } : x));
    push(`missing-threshold:${nr.over}`, "partial-update", `Threshold ${nr.over.toLocaleString("en-US")} never added (${prev.row} continues)`, rows);
  }
  push("stale-table", "partial-update", "Entire table still TY2026 (surcharge included)", oldP.rows, oldP.surcharge);

  // legacy-branch
  if (oldP.surcharge && !newP.surcharge) {
    push("legacy-surcharge:>", "legacy-branch", "Withdrawn surcharge still applied when income exceeds the threshold", newP.rows, oldP.surcharge);
    push("legacy-surcharge:>=", "legacy-branch", "Withdrawn surcharge still applied from the threshold inclusive", newP.rows, oldP.surcharge, true);
  }

  // branch-typo: row selection uses T±w, formula uses the true rows.
  // Typos at thresholds the amendment did not touch are regressions, not
  // policy-update faults: generated and reported, but as "out-of-scope-typo".
  const changedDelta = computeScheduleDelta(oldP, newP);
  const inDelta = (T: number) => changedDelta.affected.some((iv) => T >= Number(parseRat(iv.lo).floor()) && (iv.hi === null || T <= Number(parseRat(iv.hi).ceil())));
  for (let i = 0; i < newP.rows.length - 1; i++) {
    const T = newP.rows[i].upTo as number;
    for (const w of [100, 1_000, 10_000]) {
      for (const dir of [1, -1]) {
        const T2 = T + dir * w;
        const lower = newP.rows[i];
        const upper = newP.rows[i + 1];
        const f = (x: number) => {
          const correct = evaluateExact(newP, x);
          const inBand = dir > 0 ? x > T && x <= T2 : x > T2 && x <= T;
          if (!inBand) return correct;
          const row = dir > 0 ? lower : upper; // the row the typo wrongly selects
          return r(row.base).add(Rational.parse(row.rate).mul(r(x).sub(r(row.over))));
        };
        out.push({
          id: `typo:${T}:${dir > 0 ? "+" : "-"}${w}`,
          family: inDelta(T) ? "branch-typo" : "out-of-scope-typo",
          description: `Branch for the ${T.toLocaleString("en-US")} threshold written as ${T2.toLocaleString("en-US")}`,
          display: f,
          suspect: [dir > 0 ? { lo: T + 1, hi: T2 } : { lo: T2 + 1, hi: T }],
        });
      }
    }
  }

  // rounding
  out.push({ id: "display-truncate", family: "rounding", description: "Display truncates to whole rupees instead of rounding", display: (x) => r(Number(evaluateExact(newP, x).floor())), suspect: whole });
  out.push({ id: "display-round-10", family: "rounding", description: "Display rounds to the nearest 10 rupees", display: (x) => roundExact(evaluateExact(newP, x).div(r(10)), "half-up").mul(r(10)), suspect: whole });
  return out;
}

export function failsFn(newP: ProgressiveSchedule, m: Mutant, cfg: ComparisonConfig): (x: number) => boolean {
  const tol = Rational.parse(String(cfg.absoluteTolerance));
  return (x: number) => roundExact(m.display(x), cfg.rounding).sub(roundExact(evaluateExact(newP, x), cfg.rounding)).abs().cmp(tol) > 0;
}

/**
 * Exact where it matters: every integer of each suspect span is scanned up
 * to `scanLimit`; beyond that, the span end is checked too. For the affine
 * differences produced by these mutants, once |difference| exceeds the
 * tolerance plus rounding it stays exceeded within a span, so the first
 * failure found from the span start is the span's minimum.
 */
export function groundTruth(fails: (x: number) => boolean, m: Mutant, breakpoints: number[], scanLimit = 20_000): GroundTruth {
  let min: number | null = null;
  let count = 0;
  for (const s of [...m.suspect].sort((a, b) => a.lo - b.lo)) {
    // Scan windows start at the span start and at every breakpoint inside it.
    const starts = [s.lo, ...breakpoints.filter((b) => b > s.lo && b <= s.hi)].sort((a, b) => a - b);
    for (const st of starts) {
      if (min !== null && st > min) break;
      const end = Math.min(s.hi, st + scanLimit);
      for (let x = st; x <= end; x++) {
        if (fails(x)) {
          count++;
          if (min === null || x < min) min = x;
          break;
        }
      }
    }
    if (min === null && fails(s.hi)) {
      min = s.hi;
      count++;
    }
    if (min !== null) break;
  }
  return { equivalent: min === null, minimalFailing: min, observedFailures: count };
}
