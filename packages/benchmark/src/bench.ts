import type { ProgressiveSchedule } from "../../policy-engine/src/types.js";
import type { ComparisonConfig } from "../../shared/src/result.js";
import { computeScheduleDelta } from "../../delta-engine/src/schedule-delta.js";
import { boundaryOnlyPlan, gridPlan, planScheduleProbes, randomPlan } from "../../generator/src/plan.js";
import { shrink1D } from "../../generator/src/shrink.js";
import { failsFn, generateMutants, groundTruth, type MutantFamily } from "./mutants.js";

export interface BenchConfig {
  domainMax: number;
  budgets: number[];
  randomSeeds: number;
  comparison: ComparisonConfig;
}

export interface MutantResult {
  id: string;
  family: MutantFamily;
  description: string;
  equivalent: boolean;
  minimalFailing: number | null;
  /** Probes to first detection (1-based) for deterministic strategies; null = not within max budget. */
  deltaDirected: number | null;
  boundaryOnly: number | null;
  /** Grid of size B detects? per budget */
  grid: Record<number, boolean>;
  /** Random: probes-to-detection per seed (null = not within max budget) */
  random: (number | null)[];
  shrink: { structured: number | null; structuredExact: boolean; bisectionOnly: number | null; bisectionExact: boolean; structuredExecutions: number } | null;
}

export interface BenchSummaryRow {
  strategy: string;
  family: MutantFamily | "all";
  mutants: number;
  detectionRate: Record<number, number>;
  median: number | null;
  p95: number | null;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

export async function runBenchmark(oldP: ProgressiveSchedule, newP: ProgressiveSchedule, cfg: BenchConfig) {
  const maxB = Math.max(...cfg.budgets);
  const delta = computeScheduleDelta(oldP, newP);
  const dPlan = planScheduleProbes(delta, oldP, newP, { ceiling: cfg.domainMax, tolerance: cfg.comparison.absoluteTolerance }).probes.map((p) => p.input.income);
  const bPlan = boundaryOnlyPlan("income", oldP, newP).probes.map((p) => p.input.income);
  const grids = Object.fromEntries(cfg.budgets.map((b) => [b, gridPlan("income", b, cfg.domainMax).probes.map((p) => p.input.income)]));
  const randoms = Array.from({ length: cfg.randomSeeds }, (_, i) => randomPlan("income", maxB, cfg.domainMax, 1000 + i).probes.map((p) => p.input.income));
  const anchors = delta.breakpoints.map((b) => b.x).concat(dPlan.slice(0, delta.cells.filter((c) => c.kind === "open" && c.affected).length));

  const results: MutantResult[] = [];
  for (const m of generateMutants(oldP, newP, cfg.domainMax)) {
    const fails = failsFn(newP, m, cfg.comparison);
    const gt = groundTruth(fails, m, delta.breakpoints.map((b) => b.x));
    const first = (xs: number[], limit = maxB) => {
      for (let i = 0; i < Math.min(limit, xs.length); i++) if (fails(xs[i])) return i + 1;
      return null;
    };
    const dd = first(dPlan);
    let shrink: MutantResult["shrink"] = null;
    if (dd !== null && gt.minimalFailing !== null) {
      const start = dPlan.slice(0, maxB).filter((x) => fails(x)).reduce((a, b) => Math.min(a, b));
      const s = await shrink1D(async (x) => fails(x), start, { min: 0, anchors });
      const b = await shrink1D(async (x) => fails(x), start, { min: 0, anchors: [], scanWindow: 0 });
      shrink = { structured: s.value, structuredExact: s.value === gt.minimalFailing, bisectionOnly: b.value, bisectionExact: b.value === gt.minimalFailing, structuredExecutions: s.executions };
    }
    results.push({
      id: m.id,
      family: m.family,
      description: m.description,
      equivalent: gt.equivalent,
      minimalFailing: gt.minimalFailing,
      deltaDirected: dd,
      boundaryOnly: first(bPlan),
      grid: Object.fromEntries(cfg.budgets.map((b) => [b, grids[b].some((x) => fails(x))])),
      random: randoms.map((xs) => first(xs)),
      shrink,
    });
  }

  const families: (MutantFamily | "all")[] = ["all", "partial-update", "legacy-branch", "branch-typo", "rounding", "out-of-scope-typo"];
  const summary: BenchSummaryRow[] = [];
  for (const fam of families) {
    const ms = results.filter((r) => !r.equivalent && (fam === "all" ? r.family !== "out-of-scope-typo" : r.family === fam));
    if (!ms.length) continue;
    const det = (vals: (number | null)[]) => Object.fromEntries(cfg.budgets.map((b) => [b, vals.filter((v) => v !== null && v <= b).length / vals.length]));
    const finite = (vals: (number | null)[]) => vals.map((v) => (v === null ? Infinity : v));
    const stat = (vals: (number | null)[]) => {
      const f = finite(vals);
      const med = quantile(f, 0.5);
      const p95 = quantile(f, 0.95);
      return { median: med === Infinity ? null : med, p95: p95 === Infinity ? null : p95 };
    };
    summary.push({ strategy: "delta-directed (CivicProbe)", family: fam, mutants: ms.length, detectionRate: det(ms.map((m) => m.deltaDirected)), ...stat(ms.map((m) => m.deltaDirected)) });
    summary.push({ strategy: "boundary-only", family: fam, mutants: ms.length, detectionRate: det(ms.map((m) => m.boundaryOnly)), ...stat(ms.map((m) => m.boundaryOnly)) });
    summary.push({ strategy: "grid", family: fam, mutants: ms.length, detectionRate: Object.fromEntries(cfg.budgets.map((b) => [b, ms.filter((m) => m.grid[b]).length / ms.length])), median: null, p95: null });
    const all = ms.flatMap((m) => m.random);
    summary.push({ strategy: `random (${cfg.randomSeeds} seeds)`, family: fam, mutants: ms.length, detectionRate: det(all), ...stat(all) });
  }
  return { config: cfg, deltaId: delta.id, planLength: dPlan.length, results, summary };
}
