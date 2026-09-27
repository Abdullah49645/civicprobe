import { Rational } from "../../shared/src/rational.js";
import { contentId } from "../../shared/src/hash.js";
import { evaluateExact, rowFor, ruleHash, surchargeApplies } from "../../policy-engine/src/evaluate.js";
import type { ProgressiveSchedule } from "../../policy-engine/src/types.js";

/**
 * PolicyDelta for progressive schedules — exact.
 *
 * Both versions are piecewise-affine in x. Collect every breakpoint of either
 * version (row bounds and surcharge thresholds). They cut [0, ∞) into
 *
 *     {b0} (b0,b1) {b1} (b1,b2) ... {bm} (bm, ∞)
 *
 * i.e. singleton cells AT each breakpoint and open cells BETWEEN them. Inside
 * an open cell neither version changes formula, so d(x) = NEW(x) − OLD(x) is
 * a single affine function there; we recover its slope and intercept exactly
 * (rational arithmetic, two interior samples) and solve d(x) = 0. Singleton
 * cells are evaluated directly, so boundary semantics ("exceeds" vs "does not
 * exceed"), jump discontinuities (surcharges) and removed/introduced rows are
 * handled without any special cases.
 *
 * Result: the exact set { x ≥ 0 : NEW(x) ≠ OLD(x) } as a union of intervals
 * with explicit open/closed endpoints, minus isolated equality points where
 * two different formulas coincide.
 *
 * Scope (stated, tested): exact for the ProgressiveSchedule family only. It
 * does not apply to arbitrary programs; eligibility rules use the separate
 * cell decomposition in condition-delta.ts.
 */

export interface Interval {
  lo: string; // rational, canonical string
  hi: string | null; // null = +∞
  loClosed: boolean;
  hiClosed: boolean;
}

export interface Cell {
  kind: "point" | "open";
  lo: string;
  hi: string | null;
  /** Row labels in force (for open cells: throughout; for points: at the point). */
  oldRow: string;
  newRow: string;
  oldSurcharge: boolean;
  newSurcharge: boolean;
  /** d = NEW − OLD. For open cells: slope of d, and the limits at both ends. */
  slope: string;
  dAtLo: string; // limit from the right for open cells; exact value for points
  dAtHi: string | null; // limit from the left (null when hi = ∞)
  affected: boolean;
  /** For open cells, a point strictly inside where d = 0 (coincidental equality). */
  zeroAt?: string;
}

export type ComponentKind =
  | "rate-changed"
  | "base-changed"
  | "threshold-introduced"
  | "threshold-removed"
  | "surcharge-removed"
  | "surcharge-introduced"
  | "surcharge-changed";

export interface DeltaComponent {
  id: string; // C1, C2, … (stable: ordered by position)
  kind: ComponentKind;
  /** Statute row this component belongs to (NEW row where possible). */
  row: string;
  summary: string;
  old: string | null;
  new: string | null;
  /** Where this component's effect starts (x > at). */
  at: number;
}

export interface ScheduleDelta {
  id: string;
  family: "progressive-schedule";
  oldPolicyId: string;
  newPolicyId: string;
  oldRuleHash: string;
  newRuleHash: string;
  breakpoints: { x: number; origin: string[] }[];
  cells: Cell[];
  affected: Interval[];
  equalityPoints: string[];
  components: DeltaComponent[];
  guarantee: string;
}

const R = (n: number) => Rational.of(n);

export function computeScheduleDelta(oldP: ProgressiveSchedule, newP: ProgressiveSchedule): ScheduleDelta {
  const bpMap = new Map<number, Set<string>>();
  const addBp = (x: number, origin: string) => {
    if (!bpMap.has(x)) bpMap.set(x, new Set());
    bpMap.get(x)!.add(origin);
  };
  addBp(0, "domain lower bound");
  for (const [tag, p] of [["old", oldP], ["new", newP]] as const) {
    for (const r of p.rows) if (r.upTo !== null) addBp(r.upTo, `${tag}: ${r.row} upper bound`);
    if (p.surcharge) addBp(p.surcharge.over, `${tag}: surcharge threshold`);
  }
  const bps = [...bpMap.keys()].sort((a, b) => a - b);

  const d = (x: Rational) => evaluateExact(newP, x).sub(evaluateExact(oldP, x));
  const cells: Cell[] = [];

  for (let i = 0; i < bps.length; i++) {
    const b = R(bps[i]);
    // Singleton cell at the breakpoint itself.
    const dp = d(b);
    cells.push({
      kind: "point",
      lo: b.toString(),
      hi: b.toString(),
      oldRow: rowFor(oldP, b).row,
      newRow: rowFor(newP, b).row,
      oldSurcharge: surchargeApplies(oldP, b),
      newSurcharge: surchargeApplies(newP, b),
      slope: "0",
      dAtLo: dp.toString(),
      dAtHi: dp.toString(),
      affected: !dp.isZero(),
    });

    // Open cell to the right.
    const hiNum = i + 1 < bps.length ? bps[i + 1] : null;
    const lo = b;
    let p1: Rational, p2: Rational;
    if (hiNum === null) {
      p1 = lo.add(R(1));
      p2 = lo.add(R(2));
    } else {
      const w = R(hiNum).sub(lo);
      p1 = lo.add(w.div(R(3)));
      p2 = lo.add(w.mul(R(2)).div(R(3)));
    }
    const d1 = d(p1);
    const d2 = d(p2);
    const slope = d2.sub(d1).div(p2.sub(p1));
    const dLo = d1.sub(slope.mul(p1.sub(lo)));
    const dHi = hiNum === null ? null : dLo.add(slope.mul(R(hiNum).sub(lo)));
    let zeroAt: Rational | undefined;
    let affected: boolean;
    if (slope.isZero()) {
      affected = !dLo.isZero();
    } else {
      affected = true;
      const root = lo.sub(dLo.div(slope));
      const insideLo = root.cmp(lo) > 0;
      const insideHi = hiNum === null || root.cmp(R(hiNum)) < 0;
      if (insideLo && insideHi) zeroAt = root;
    }
    cells.push({
      kind: "open",
      lo: lo.toString(),
      hi: hiNum === null ? null : String(hiNum),
      oldRow: rowFor(oldP, p1).row,
      newRow: rowFor(newP, p1).row,
      oldSurcharge: surchargeApplies(oldP, p1),
      newSurcharge: surchargeApplies(newP, p1),
      slope: slope.toString(),
      dAtLo: dLo.toString(),
      dAtHi: dHi === null ? null : dHi.toString(),
      affected,
      zeroAt: zeroAt?.toString(),
    });
  }

  const { affected, equalityPoints } = mergeAffected(cells);
  const components = diffComponents(oldP, newP);
  const oldRuleHash = ruleHash(oldP);
  const newRuleHash = ruleHash(newP);

  return {
    id: contentId("delta", { oldRuleHash, newRuleHash }),
    family: "progressive-schedule",
    oldPolicyId: oldP.id,
    newPolicyId: newP.id,
    oldRuleHash,
    newRuleHash,
    breakpoints: bps.map((x) => ({ x, origin: [...bpMap.get(x)!].sort() })),
    cells,
    affected,
    equalityPoints,
    components,
    guarantee:
      "Exact over the reals for the progressive-schedule rule family: every x ≥ 0 with NEW(x) ≠ OLD(x) lies in `affected`, and every x in `affected` other than `equalityPoints` has NEW(x) ≠ OLD(x). Computed with rational arithmetic; no tolerance.",
  };
}

/** Merge cells into maximal intervals with explicit endpoint closure. */
function mergeAffected(cells: Cell[]): { affected: Interval[]; equalityPoints: string[] } {
  const out: Interval[] = [];
  const eq: string[] = [];
  const push = (iv: Interval) => {
    const last = out[out.length - 1];
    if (last && last.hi !== null && last.hi === iv.lo && (last.hiClosed || iv.loClosed)) {
      last.hi = iv.hi;
      last.hiClosed = iv.hiClosed;
    } else {
      out.push({ ...iv });
    }
  };
  for (const c of cells) {
    if (!c.affected) continue;
    if (c.kind === "point") {
      push({ lo: c.lo, hi: c.lo, loClosed: true, hiClosed: true });
    } else if (c.zeroAt) {
      eq.push(c.zeroAt);
      push({ lo: c.lo, hi: c.zeroAt, loClosed: false, hiClosed: false });
      push({ lo: c.zeroAt, hi: c.hi, loClosed: false, hiClosed: false });
    } else {
      push({ lo: c.lo, hi: c.hi, loClosed: false, hiClosed: false });
    }
  }
  return { affected: out, equalityPoints: eq };
}

/** Is x (a JS number) inside the exact affected set? */
export function inAffected(delta: { affected: Interval[] }, x: number): boolean {
  const xr = R(x);
  return delta.affected.some((iv) => {
    const c1 = xr.cmp(parseRat(iv.lo));
    if (c1 < 0 || (c1 === 0 && !iv.loClosed)) return false;
    if (iv.hi === null) return true;
    const c2 = xr.cmp(parseRat(iv.hi));
    return c2 < 0 || (c2 === 0 && iv.hiClosed);
  });
}

export function parseRat(s: string): Rational {
  const [n, d] = s.split("/");
  return d === undefined ? Rational.of(BigInt(n)) : Rational.of(BigInt(n), BigInt(d));
}

/**
 * Structural "what changed", in statute terms. Each component is one edit a
 * drafter made: a rate, a fixed amount, a new or removed threshold, or the
 * surcharge. Used for the UI's redline view and for attributing observed
 * discrepancies back to specific edits.
 */
function diffComponents(oldP: ProgressiveSchedule, newP: ProgressiveSchedule): DeltaComponent[] {
  const comps: Omit<DeltaComponent, "id">[] = [];
  const oldUppers = new Set(oldP.rows.map((r) => r.upTo).filter((x): x is number => x !== null));
  const newUppers = new Set(newP.rows.map((r) => r.upTo).filter((x): x is number => x !== null));
  const pct = (r: string) => `${Rational.parse(r).mul(R(100)).toDecimalString()}%`;
  const money = (n: number) => n.toLocaleString("en-US");

  for (const t of [...newUppers].filter((x) => !oldUppers.has(x)).sort((a, b) => a - b)) {
    const row = newP.rows.find((r) => r.over === t)!;
    comps.push({ kind: "threshold-introduced", row: row.row, summary: `New threshold at ${money(t)} (${row.row} begins)`, old: null, new: money(t), at: t });
  }
  for (const t of [...oldUppers].filter((x) => !newUppers.has(x)).sort((a, b) => a - b)) {
    comps.push({ kind: "threshold-removed", row: rowFor(newP, R(t)).row, summary: `Threshold at ${money(t)} removed`, old: money(t), new: null, at: t });
  }
  for (const nr of newP.rows) {
    const probe = R(nr.over).add(R(1));
    const or = rowFor(oldP, probe);
    if (or.rate !== nr.rate) {
      comps.push({ kind: "rate-changed", row: nr.row, summary: `${nr.row}: marginal rate ${pct(or.rate)} → ${pct(nr.rate)}`, old: pct(or.rate), new: pct(nr.rate), at: nr.over });
    }
    // Fixed amount at the row's lower edge (tax owed at exactly `over`, before surcharge).
    const oldAtEdge = R(or.base).add(Rational.parse(or.rate).mul(R(nr.over).sub(R(or.over))));
    if (!oldAtEdge.eq(R(nr.base))) {
      comps.push({ kind: "base-changed", row: nr.row, summary: `${nr.row}: fixed amount ${money(oldAtEdge.toNumber())} → ${money(nr.base)}`, old: money(oldAtEdge.toNumber()), new: money(nr.base), at: nr.over });
    }
  }
  const os = oldP.surcharge;
  const ns = newP.surcharge;
  if (os && !ns) comps.push({ kind: "surcharge-removed", row: os.row, summary: `Surcharge of ${pct(os.rateOnTax)} above ${money(os.over)} withdrawn`, old: pct(os.rateOnTax), new: null, at: os.over });
  if (!os && ns) comps.push({ kind: "surcharge-introduced", row: ns.row, summary: `Surcharge of ${pct(ns.rateOnTax)} above ${money(ns.over)} introduced`, old: null, new: pct(ns.rateOnTax), at: ns.over });
  if (os && ns && (os.over !== ns.over || os.rateOnTax !== ns.rateOnTax)) {
    comps.push({ kind: "surcharge-changed", row: ns.row, summary: `Surcharge ${pct(os.rateOnTax)} above ${money(os.over)} → ${pct(ns.rateOnTax)} above ${money(ns.over)}`, old: pct(os.rateOnTax), new: pct(ns.rateOnTax), at: Math.min(os.over, ns.over) });
  }
  const order: Record<ComponentKind, number> = {
    "threshold-introduced": 0, "threshold-removed": 0, "rate-changed": 1, "base-changed": 2,
    "surcharge-removed": 3, "surcharge-introduced": 3, "surcharge-changed": 3,
  };
  comps.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
  return comps.map((c, i) => ({ id: `C${i + 1}`, ...c }));
}

/** Numeric approximation of d = NEW − OLD at x, for plotting. */
export function deltaAt(oldP: ProgressiveSchedule, newP: ProgressiveSchedule, x: number): number {
  return evaluateExact(newP, x).sub(evaluateExact(oldP, x)).toNumber();
}

/**
 * Statute edits responsible for behaviour at x: the edits to the NEW row in
 * force at x (rate, fixed amount, introduced/removed threshold), plus any
 * surcharge edit whose applicability differs between versions at x.
 */
export function componentsAt(delta: ScheduleDelta, x: number, oldP: ProgressiveSchedule, newP: ProgressiveSchedule): string[] {
  const xr = R(x);
  const nr = rowFor(newP, xr);
  const surchargeDiffers = surchargeApplies(oldP, xr) !== surchargeApplies(newP, xr);
  return delta.components
    .filter((c) => {
      if (c.kind.startsWith("surcharge")) return surchargeDiffers || (c.kind === "surcharge-changed" && x > c.at);
      return c.row === nr.row && x > c.at;
    })
    .map((c) => c.id);
}
