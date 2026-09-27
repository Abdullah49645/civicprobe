import { Rational } from "../../shared/src/rational.js";
import { contentId } from "../../shared/src/hash.js";
import { mulberry32 } from "../../shared/src/random.js";
import { parseRat, type Cell, type ScheduleDelta } from "../../delta-engine/src/schedule-delta.js";
import type { ConditionDelta } from "../../delta-engine/src/condition-delta.js";
import type { ProgressiveSchedule } from "../../policy-engine/src/types.js";

export const GENERATOR = { name: "civicprobe-planner", version: "2.0.0" } as const;

export type Strategy =
  | "divergence-witness"
  | "boundary"
  | "interior"
  | "equality-check"
  | "control"
  | "delta-random"
  | "random"
  | "grid"
  | "boundary-only";

export interface ProbeRationale {
  summary: string;
  anchor?: number;
  offset?: number;
  cell?: { lo: string; hi: string | null };
  /** NEW − OLD at this input, exact (schedules only). */
  expectedDelta?: string;
}

export interface Probe {
  id: string;
  input: Record<string, number>;
  strategy: Strategy;
  inAffectedRegion: boolean;
  rationale: ProbeRationale;
}

export interface ProbePlan {
  id: string;
  deltaId: string | null;
  generator: typeof GENERATOR;
  strategy: string;
  seed: number;
  options: Record<string, number | boolean | string>;
  probes: Probe[];
}

const fmt = (n: number) => n.toLocaleString("en-US");

function probeId(deltaId: string | null, input: Record<string, number>, strategy: Strategy): string {
  return contentId("probe", { deltaId, input, strategy });
}

function finalize(deltaId: string | null, strategy: string, seed: number, options: ProbePlan["options"], probes: Probe[]): ProbePlan {
  return {
    id: contentId("plan", { deltaId, generator: GENERATOR, strategy, seed, options, probes: probes.map((p) => p.id) }),
    deltaId,
    generator: GENERATOR,
    strategy,
    seed,
    options,
    probes,
  };
}

// ---------------------------------------------------------------------------
// Delta-directed plan for progressive schedules

export interface SchedulePlanOptions {
  /** Upper end used for probes in the open-ended top cell (and random fill). */
  ceiling: number;
  /** Deterministic seeded probes inside the affected region, after the structural tiers. */
  randomFill: number;
  /** Include a few probes where behaviour must NOT have changed. */
  controls: boolean;
  seed: number;
  /** Truncate the ordered plan to this many probes (0 = no limit). */
  budget: number;
  /**
   * Absolute tolerance of the comparison the plan will be judged by. Used to
   * place "observability" probes: a misplaced threshold is invisible until the
   * two adjacent rows' formulas differ by more than the tolerance (+1 for
   * whole-unit rounding on each side).
   */
  tolerance: number;
}

export const DEFAULT_SCHEDULE_PLAN: SchedulePlanOptions = { ceiling: 12_000_000, randomFill: 8, controls: true, seed: 2026, budget: 0, tolerance: 0 };

/**
 * The ordered probe plan. Tiers, each swept across affected cells in
 * ascending order:
 *
 *  1. divergence witness — in every affected open cell, the integer where
 *     |NEW − OLD| is largest. d is affine in a cell, so the maximum is at an
 *     end. Tax schedules are continuous, so right AT a changed threshold the
 *     two versions differ by almost nothing; the difference grows away from
 *     it. A stale rate shows up as a sub-rupee error at T+1 (invisible after
 *     whole-rupee display rounding) but as tens of thousands of rupees at the
 *     far end of the row. Witnesses go first for that reason.
 *  2. boundary — each breakpoint T touching the affected region: T itself,
 *     T+1 (first input the statute places in the next row), and T−1.
 *     Catches boundary-semantics faults ("≥" vs "exceeds") and threshold typos.
 *  3. interior — the midpoint of each affected cell.
 *  4. equality check — around points where two different formulas coincide.
 *  5. control — unaffected cells, where behaviour must not have changed.
 *  6. delta-random — seeded uniform draws restricted to the affected region.
 */
export function planScheduleProbes(delta: ScheduleDelta, oldP: ProgressiveSchedule, newP: ProgressiveSchedule, opts: Partial<SchedulePlanOptions> = {}): ProbePlan {
  const o = { ...DEFAULT_SCHEDULE_PLAN, ...opts };
  const probes: Probe[] = [];
  const seen = new Set<number>();
  const dAt = (x: number) => {
    const c = cellContaining(delta.cells, x);
    if (!c) return "0";
    if (c.kind === "point") return c.dAtLo;
    return parseRat(c.dAtLo).add(parseRat(c.slope).mul(Rational.of(x).sub(parseRat(c.lo)))).toString();
  };
  const add = (x: number, strategy: Strategy, r: ProbeRationale) => {
    if (!Number.isSafeInteger(x) || x < oldP.input.min || seen.has(x)) return;
    seen.add(x);
    const inAff = isAffected(delta, x);
    probes.push({ id: probeId(delta.id, { [newP.input.name]: x }, strategy), input: { [newP.input.name]: x }, strategy, inAffectedRegion: inAff, rationale: { ...r, expectedDelta: dAt(x) } });
  };
  const openAffected = delta.cells.filter((c) => c.kind === "open" && c.affected);
  const rowName = (c: Cell) => (c.oldRow === c.newRow ? c.newRow : `${c.newRow} (was ${c.oldRow})`);

  // 1. divergence witnesses
  for (const c of openAffected) {
    const lo = parseRat(c.lo);
    const firstInside = Number(lo.floor()) + 1;
    const lastInside = c.hi === null ? Math.max(o.ceiling, firstInside) : Number(parseRat(c.hi).ceil()) - 1;
    if (lastInside < firstInside) continue;
    const dLo = parseRat(c.dAtLo).abs();
    const dHi = c.dAtHi === null ? (parseRat(c.slope).isZero() ? dLo : dLo.add(Rational.ONE)) : parseRat(c.dAtHi).abs();
    let x = dHi.cmp(dLo) >= 0 ? lastInside : firstInside;
    if (c.zeroAt && Rational.of(x).eq(parseRat(c.zeroAt))) x = x === lastInside ? x - 1 : x + 1;
    add(x, "divergence-witness", {
      summary: `Largest |NEW − OLD| inside ${rowName(c)}: the two versions disagree most here, so an implementation stuck on either side of this edit is most visible here.`,
      cell: { lo: c.lo, hi: c.hi },
    });
  }

  // 2. boundaries touching the affected region
  const affectedBps = delta.breakpoints.filter((b) => {
    const idx = delta.cells.findIndex((c) => c.kind === "point" && c.lo === String(b.x));
    const left = delta.cells[idx - 1];
    const self = delta.cells[idx];
    const right = delta.cells[idx + 1];
    return !!(self?.affected || left?.affected || right?.affected);
  });
  for (const b of affectedBps) {
    const why = b.origin.filter((s) => s !== "domain lower bound").join("; ");
    add(b.x + 1, "boundary", { summary: `First input the statute places above ${fmt(b.x)} ("exceeds ${fmt(b.x)}"). ${why}.`, anchor: b.x, offset: 1 });
    add(b.x, "boundary", { summary: `Exactly ${fmt(b.x)}: "does not exceed" keeps this in the lower row. ${why}.`, anchor: b.x, offset: 0 });
    add(b.x - 1, "boundary", { summary: `Just below ${fmt(b.x)}. ${why}.`, anchor: b.x, offset: -1 });
  }

  // 2b. observability probes. Tax is continuous at a threshold T, so a
  // service that puts T in the wrong place (a typo in a branch condition, an
  // off-by-some bound) agrees with the statute AT T and only disagrees by
  // |slopeRight − slopeLeft| per rupee away from it. Under a comparison with
  // tolerance τ and whole-unit rounding (each side moves ≤ 0.5), a raw
  // difference > τ + 1 guarantees a rounded difference > τ. So the fault is
  // guaranteed visible at the smallest k with Δslope·k > τ + 1, i.e.
  // k = ⌊(τ + 1) / Δslope⌋ + 1. Probe T + k and T − k.
  for (const b of affectedBps) {
    const left = newP.rows.find((r) => r.upTo === b.x);
    const right = newP.rows.find((r) => r.over === b.x);
    if (!left || !right) continue;
    const dSlope = Rational.parse(right.rate).sub(Rational.parse(left.rate)).abs();
    if (dSlope.isZero()) continue;
    const k = Number(Rational.of(o.tolerance + 1).div(dSlope).floor()) + 1;
    const why = `Where a misplaced ${fmt(b.x)} threshold must become visible: the rows on either side differ by ${dSlope.mul(Rational.of(100)).toDecimalString()}% per rupee, so after whole-rupee rounding and a tolerance of ${o.tolerance}, a misplacement shows ${fmt(k)} rupees from the threshold, not at T±1.`;
    add(b.x + k, "boundary", { summary: why, anchor: b.x, offset: k });
    add(b.x - k, "boundary", { summary: why, anchor: b.x, offset: -k });
  }

  // 3. interior midpoints
  for (const c of openAffected) {
    const lo = Number(parseRat(c.lo).floor());
    const hi = c.hi === null ? o.ceiling : Number(parseRat(c.hi).ceil());
    const mid = Math.floor((lo + hi) / 2);
    add(mid, "interior", { summary: `Midpoint of ${rowName(c)}.`, cell: { lo: c.lo, hi: c.hi } });
  }

  // 4. coincidental equalities
  for (const z of delta.equalityPoints) {
    const zr = parseRat(z);
    add(Number(zr.floor()), "equality-check", { summary: `NEW and OLD coincide at ${zr.toDecimalString()}: an implementation of EITHER version agrees here. Probed to document, not to detect.` });
  }

  // 5. controls
  if (o.controls) {
    for (const c of delta.cells.filter((c) => c.kind === "open" && !c.affected)) {
      const lo = Number(parseRat(c.lo).floor());
      const hi = c.hi === null ? o.ceiling : Number(parseRat(c.hi).ceil());
      add(Math.floor((lo + hi) / 2), "control", { summary: `Control: ${c.newRow} did not change, so behaviour here must be identical under both versions.`, cell: { lo: c.lo, hi: c.hi } });
    }
  }

  // 6. seeded fill inside the affected region
  const rng = mulberry32(o.seed);
  const spans = openAffected.map((c) => ({ lo: Number(parseRat(c.lo).floor()) + 1, hi: c.hi === null ? o.ceiling : Number(parseRat(c.hi).ceil()) - 1 })).filter((s) => s.hi >= s.lo);
  const total = spans.reduce((n, s) => n + (s.hi - s.lo + 1), 0);
  for (let i = 0, guard = 0; i < o.randomFill && total > 0 && guard < o.randomFill * 20; guard++) {
    let k = Math.floor(rng() * total);
    for (const s of spans) {
      const w = s.hi - s.lo + 1;
      if (k < w) {
        const before = probes.length;
        add(s.lo + k, "delta-random", { summary: `Seeded draw (seed ${o.seed}) uniformly over the affected region only.` });
        if (probes.length > before) i++;
        break;
      }
      k -= w;
    }
  }

  const final = o.budget > 0 ? probes.slice(0, o.budget) : probes;
  return finalize(delta.id, "delta-directed", o.seed, { ...o }, final);
}

function cellContaining(cells: Cell[], x: number): Cell | undefined {
  const xr = Rational.of(x);
  return cells.find((c) => {
    const lo = parseRat(c.lo);
    if (c.kind === "point") return xr.eq(lo);
    if (xr.cmp(lo) <= 0) return false;
    return c.hi === null || xr.cmp(parseRat(c.hi)) < 0;
  });
}

function isAffected(delta: ScheduleDelta, x: number): boolean {
  const c = cellContaining(delta.cells, x);
  if (!c) return false;
  if (!c.affected) return false;
  return !(c.zeroAt && Rational.of(x).eq(parseRat(c.zeroAt)));
}

// ---------------------------------------------------------------------------
// Baselines (for the benchmark). Same Probe shape, no delta knowledge.

export function randomPlan(field: string, n: number, max: number, seed: number): ProbePlan {
  const rng = mulberry32(seed);
  const probes: Probe[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rng() * (max + 1));
    probes.push({ id: probeId(null, { [field]: x }, "random"), input: { [field]: x }, strategy: "random", inAffectedRegion: false, rationale: { summary: `Uniform draw on [0, ${fmt(max)}], seed ${seed}.` } });
  }
  return finalize(null, "random", seed, { n, max }, probes);
}

export function gridPlan(field: string, n: number, max: number): ProbePlan {
  const probes: Probe[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.round(((i + 1) / n) * max);
    probes.push({ id: probeId(null, { [field]: x }, "grid"), input: { [field]: x }, strategy: "grid", inAffectedRegion: false, rationale: { summary: `Evenly spaced grid point ${i + 1}/${n} on (0, ${fmt(max)}].` } });
  }
  return finalize(null, "grid", 0, { n, max }, probes);
}

/**
 * Classic boundary-value analysis without delta knowledge: T−1, T, T+1 for
 * every threshold of BOTH versions, in ascending order.
 */
export function boundaryOnlyPlan(field: string, oldP: ProgressiveSchedule, newP: ProgressiveSchedule): ProbePlan {
  const ts = new Set<number>();
  for (const p of [oldP, newP]) {
    for (const r of p.rows) if (r.upTo !== null) ts.add(r.upTo);
    if (p.surcharge) ts.add(p.surcharge.over);
  }
  const probes: Probe[] = [];
  const seen = new Set<number>();
  for (const t of [...ts].sort((a, b) => a - b)) {
    for (const x of [t - 1, t, t + 1]) {
      if (x < 0 || seen.has(x)) continue;
      seen.add(x);
      probes.push({ id: probeId(null, { [field]: x }, "boundary-only"), input: { [field]: x }, strategy: "boundary-only", inAffectedRegion: false, rationale: { summary: `Boundary-value analysis around ${fmt(t)} (threshold of either version).`, anchor: t, offset: x - t } });
    }
  }
  return finalize(null, "boundary-only", 0, {}, probes);
}

// ---------------------------------------------------------------------------
// Delta-directed plan for eligibility rules (multi-field)

export function planConditionProbes(delta: ConditionDelta, opts: { controls?: number } = {}): ProbePlan {
  const controls = opts.controls ?? 4;
  const probes: Probe[] = [];
  const seen = new Set<string>();
  const add = (input: Record<string, number>, strategy: Strategy, affected: boolean, r: ProbeRationale) => {
    const k = JSON.stringify(input);
    if (seen.has(k)) return;
    seen.add(k);
    probes.push({ id: probeId(delta.id, input, strategy), input, strategy, inAffectedRegion: affected, rationale: r });
  };
  const desc = (ranges: Record<string, { lo: number; hi: number }>) =>
    Object.entries(ranges).map(([f, s]) => (s.lo === s.hi ? `${f} = ${fmt(s.lo)}` : `${f} ∈ [${fmt(s.lo)}, ${fmt(s.hi)}]`)).join(", ");
  const affected = delta.cells.filter((c) => c.affected);

  // One witness per affected cell: its corner nearest the simplest citizen.
  // Every point of an affected cell differs (the outcome is constant per cell).
  for (const c of affected) {
    const input = Object.fromEntries(Object.entries(c.ranges).map(([f, s]) => [f, s.lo]));
    add(input, "divergence-witness", true, { summary: `Cell ${desc(c.ranges)}: outcome changed from "${c.oldOutcome}" to "${c.newOutcome}".` });
  }
  // Boundary: step one unit across each face of each affected cell.
  for (const c of affected) {
    const base = Object.fromEntries(Object.entries(c.ranges).map(([f, s]) => [f, s.lo]));
    for (const f of delta.fields) {
      const s = c.ranges[f.name];
      for (const v of [s.lo - 1, s.hi + 1]) {
        if (v < f.min || v > f.max) continue;
        const input = { ...base, [f.name]: v };
        const cell = delta.cells.find((x) => Object.entries(x.ranges).every(([k, r]) => input[k] >= r.lo && input[k] <= r.hi));
        add(input, "boundary", !!cell?.affected, { summary: `One step across the ${f.label.toLowerCase()} face of ${desc(c.ranges)} (${f.name} = ${fmt(v)}).`, anchor: v === s.lo - 1 ? s.lo : s.hi, offset: v === s.lo - 1 ? -1 : 1 });
      }
    }
  }
  for (const c of delta.cells.filter((c) => !c.affected).slice(0, controls)) {
    const input = Object.fromEntries(Object.entries(c.ranges).map(([f, s]) => [f, s.lo]));
    add(input, "control", false, { summary: `Control: outcome "${c.newOutcome}" is the same under both versions for ${desc(c.ranges)}.` });
  }
  return finalize(delta.id, "delta-directed", 0, { controls }, probes);
}
