import { Rational } from "../../shared/src/rational.js";
import type { ComparisonConfig } from "../../shared/src/result.js";
import { roundExact } from "../../comparator/src/compare.js";
import { generateMutants } from "../../benchmark/src/mutants.js";
import { evaluateEligibility } from "../../policy-engine/src/evaluate.js";
import type { Condition, EligibilityRule, ProgressiveSchedule } from "../../policy-engine/src/types.js";
import type { ScheduleDelta } from "../../delta-engine/src/schedule-delta.js";
import type { ConditionDelta } from "../../delta-engine/src/condition-delta.js";
import type { Execution } from "../../evidence/src/run.js";

/**
 * Diagnosis: WHICH edit was not implemented?
 *
 * Detection says the service differs from the new rule. Attribution
 * (MATCHES_OLD / MATCHES_NEITHER) says whether it matches the old rule. A
 * diagnosis goes further. Enumerate single-fault hypotheses derived from
 * the delta itself: each edit left stale on its own, each new threshold
 * missing, the withdrawn branch still live, a misplaced threshold. Keep only
 * the hypotheses that reproduce EVERY observation the service returned,
 * conforming and discrepant alike, under the same comparison rule.
 *
 * This is falsification, not inference. A hypothesis survives only if no
 * observation contradicts it. Several may survive, and all survivors are
 * reported. None surviving is also a result: "the fault is not a single
 * stale edit".
 */
export interface Hypothesis {
  id: string;
  description: string;
  components: string[];
  /** Observations it reproduces (all of them, or it is not listed). */
  checked: number;
}

export interface Diagnosis {
  hypothesesTested: number;
  consistent: Hypothesis[];
  observations: number;
  method: string;
}

function componentsForMutant(id: string, d: ScheduleDelta): string[] {
  const [kind, arg] = [id.split(":")[0], id.slice(id.indexOf(":") + 1)];
  const c = d.components;
  switch (kind) {
    case "stale-rate": return c.filter((x) => x.kind === "rate-changed" && x.row === arg).map((x) => x.id);
    case "stale-base": return c.filter((x) => x.kind === "base-changed" && x.row === arg).map((x) => x.id);
    case "stale-row": return c.filter((x) => (x.kind === "rate-changed" || x.kind === "base-changed") && x.row === arg).map((x) => x.id);
    case "missing-threshold": return c.filter((x) => x.kind === "threshold-introduced" && String(x.at) === arg).map((x) => x.id);
    case "legacy-surcharge": return c.filter((x) => x.kind.startsWith("surcharge")).map((x) => x.id);
    case "stale-table": return c.map((x) => x.id);
    default: return [];
  }
}

export function diagnoseSchedule(oldP: ProgressiveSchedule, newP: ProgressiveSchedule, delta: ScheduleDelta, executions: Execution[], cfg: ComparisonConfig, domainMax: number): Diagnosis {
  const obs = executions.filter((e) => e.observation.status === "ok" && e.observation.value !== null);
  const tol = Rational.parse(String(cfg.absoluteTolerance));
  const mutants = generateMutants(oldP, newP, domainMax).filter((m) => m.family !== "rounding");
  const consistent: Hypothesis[] = [];
  for (const m of mutants) {
    const ok = obs.every((e) => {
      const predicted = roundExact(m.display(e.executedInput[newP.input.name]), cfg.rounding);
      return predicted.sub(roundExact(Rational.parse(e.observation.value as string), cfg.rounding)).abs().cmp(tol) <= 0;
    });
    if (ok) consistent.push({ id: m.id, description: m.description, components: componentsForMutant(m.id, delta), checked: obs.length });
  }
  return {
    hypothesesTested: mutants.length,
    consistent,
    observations: obs.length,
    method: "Single-fault hypotheses generated from the delta (each edit stale alone, each new threshold missing, withdrawn branch still applied, misplaced thresholds, whole table stale). A hypothesis is kept only if it reproduces every observed output within the comparison rule.",
  };
}

function revertLeaf(c: Condition, field: string, newValue: number, oldValue: number): Condition {
  switch (c.kind) {
    case "cmp": return c.field === field && c.value === newValue ? { ...c, value: oldValue } : c;
    case "in": return c;
    case "and": case "or": return { ...c, conditions: c.conditions.map((x) => revertLeaf(x, field, newValue, oldValue)) };
    case "not": return { ...c, condition: revertLeaf(c.condition, field, newValue, oldValue) };
  }
}

export function diagnoseCondition(oldR: EligibilityRule, newR: EligibilityRule, delta: ConditionDelta, executions: Execution[]): Diagnosis {
  const obs = executions.filter((e) => e.observation.status === "ok" && e.observation.value !== null);
  const num = (s: string | null) => (s ? Number(s.replace(/[^0-9]/g, "")) : NaN);
  const hyps: { id: string; description: string; components: string[]; rule: EligibilityRule }[] = [];
  for (const c of delta.components) {
    if (c.old === null || c.new === null) continue;
    hyps.push({ id: `stale:${c.id}`, description: `${c.summary.split(":")[0]} left at the old condition (${c.old})`, components: [c.id], rule: { ...newR, condition: revertLeaf(newR.condition, c.field, num(c.new), num(c.old)) } });
  }
  hyps.push({ id: "stale-rule", description: "Entire rule still the old version", components: delta.components.map((c) => c.id), rule: oldR });
  const consistent = hyps
    .filter((h) => obs.every((e) => evaluateEligibility(h.rule, e.executedInput).toLowerCase() === (e.observation.value as string).toLowerCase()))
    .map((h) => ({ id: h.id, description: h.description, components: h.components, checked: obs.length }));
  return { hypothesesTested: hyps.length, consistent, observations: obs.length, method: "Single-edit reversions of the delta's components, plus the whole old rule. Kept only if every observed outcome is reproduced." };
}
