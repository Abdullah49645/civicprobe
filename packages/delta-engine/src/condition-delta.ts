import { contentId } from "../../shared/src/hash.js";
import { assert } from "../../shared/src/assert.js";
import { evaluateEligibility, ruleHash } from "../../policy-engine/src/evaluate.js";
import type { Condition, EligibilityRule, FieldSpec, PersonAttributes } from "../../policy-engine/src/types.js";

/**
 * PolicyDelta for eligibility rules — exact, by cell decomposition.
 *
 * Every leaf compares an integer field to a constant. For an integer field,
 * `x op v` has constant truth on each of (−∞, v−1], {v}, [v+1, ∞). Collect
 * every constant a field is compared to in EITHER version; those constants
 * cut the field's bounded domain into segments on which every leaf is
 * constant. The Cartesian product of segments across fields is a finite set
 * of axis-aligned cells on which BOTH rules are constant, so evaluating each
 * rule once per cell decides the whole cell exactly.
 *
 * This replaces the previous bounded scan (which could miss a narrow region
 * between scan points). Cost is the product of segment counts; fine for the
 * handful of fields/thresholds a screener rule has, and it refuses (throws)
 * rather than silently degrading past `maxCells`.
 */

export interface Segment {
  lo: number;
  hi: number;
}

export interface ConditionCell {
  ranges: Record<string, Segment>;
  oldOutcome: string;
  newOutcome: string;
  affected: boolean;
}

export interface ConditionComponent {
  id: string;
  field: string;
  summary: string;
  old: string | null;
  new: string | null;
}

export interface ConditionDelta {
  id: string;
  family: "eligibility-rule";
  oldPolicyId: string;
  newPolicyId: string;
  oldRuleHash: string;
  newRuleHash: string;
  fields: FieldSpec[];
  criticalValues: Record<string, number[]>;
  cells: ConditionCell[];
  components: ConditionComponent[];
  guarantee: string;
}

function leaves(c: Condition, out: { field: string; op: string; value: number }[] = []) {
  switch (c.kind) {
    case "cmp":
      out.push({ field: c.field, op: c.op, value: c.value });
      break;
    case "in":
      for (const v of c.values) {
        assert(typeof v === "number", "condition-delta supports numeric `in` values only");
        out.push({ field: c.field, op: "in", value: v });
      }
      break;
    case "and":
    case "or":
      c.conditions.forEach((x) => leaves(x, out));
      break;
    case "not":
      leaves(c.condition, out);
      break;
  }
  return out;
}

export function segmentsFor(field: FieldSpec, critical: number[]): Segment[] {
  const cuts = [...new Set(critical)].filter((v) => v >= field.min && v <= field.max).sort((a, b) => a - b);
  const segs: Segment[] = [];
  let cursor = field.min;
  for (const v of cuts) {
    if (cursor <= v - 1) segs.push({ lo: cursor, hi: v - 1 });
    segs.push({ lo: v, hi: v });
    cursor = v + 1;
  }
  if (cursor <= field.max) segs.push({ lo: cursor, hi: field.max });
  return segs;
}

export function computeConditionDelta(oldR: EligibilityRule, newR: EligibilityRule, maxCells = 10_000): ConditionDelta {
  assert(JSON.stringify(oldR.fields.map((f) => f.name)) === JSON.stringify(newR.fields.map((f) => f.name)), "both versions must declare the same fields");
  const fields = newR.fields;
  const allLeaves = [...leaves(oldR.condition), ...leaves(newR.condition)];
  const critical: Record<string, number[]> = {};
  for (const f of fields) critical[f.name] = [...new Set(allLeaves.filter((l) => l.field === f.name).map((l) => l.value))].sort((a, b) => a - b);
  const segs = fields.map((f) => segmentsFor(f, critical[f.name]));
  const total = segs.reduce((n, s) => n * s.length, 1);
  assert(total <= maxCells, `condition-delta: ${total} cells exceeds maxCells=${maxCells}; refusing to approximate`);

  const cells: ConditionCell[] = [];
  const idx = new Array(fields.length).fill(0);
  for (let k = 0; k < total; k++) {
    const ranges: Record<string, Segment> = {};
    const rep: PersonAttributes = {};
    fields.forEach((f, i) => {
      ranges[f.name] = segs[i][idx[i]];
      rep[f.name] = segs[i][idx[i]].lo;
    });
    const o = evaluateEligibility(oldR, rep);
    const n = evaluateEligibility(newR, rep);
    cells.push({ ranges, oldOutcome: o, newOutcome: n, affected: o !== n });
    for (let i = fields.length - 1; i >= 0; i--) {
      idx[i]++;
      if (idx[i] < segs[i].length) break;
      idx[i] = 0;
    }
  }

  // Components: per field, thresholds present in one version but not the other.
  const comps: ConditionComponent[] = [];
  const key = (l: { field: string; op: string; value: number }) => `${l.field}|${l.op}|${l.value}`;
  const oldSet = new Map(leaves(oldR.condition).map((l) => [key(l), l]));
  const newSet = new Map(leaves(newR.condition).map((l) => [key(l), l]));
  for (const f of fields) {
    const removed = [...oldSet.values()].filter((l) => l.field === f.name && !newSet.has(key(l)));
    const added = [...newSet.values()].filter((l) => l.field === f.name && !oldSet.has(key(l)));
    const pairs = Math.max(removed.length, added.length);
    for (let i = 0; i < pairs; i++) {
      const a = removed[i];
      const b = added[i];
      const fmt = (l?: { op: string; value: number }) => (l ? `${f.name} ${l.op} ${l.value.toLocaleString("en-US")}` : null);
      comps.push({
        id: `C${comps.length + 1}`,
        field: f.name,
        summary: a && b ? `${f.label}: ${fmt(a)} → ${fmt(b)}` : a ? `${f.label}: condition ${fmt(a)} removed` : `${f.label}: condition ${fmt(b)} added`,
        old: fmt(a),
        new: fmt(b),
      });
    }
  }

  const oldRuleHash = ruleHash(oldR);
  const newRuleHash = ruleHash(newR);
  return {
    id: contentId("delta", { oldRuleHash, newRuleHash }),
    family: "eligibility-rule",
    oldPolicyId: oldR.id,
    newPolicyId: newR.id,
    oldRuleHash,
    newRuleHash,
    fields,
    criticalValues: critical,
    cells,
    components: comps,
    guarantee:
      "Exact over the declared integer field domains for rules whose leaves compare integer fields to constants: each cell is a box on which both rules are constant, so `affected` cells are exactly the inputs where the outcome changed.",
  };
}

export function cellOf(delta: ConditionDelta, person: PersonAttributes): ConditionCell | undefined {
  return delta.cells.find((c) => Object.entries(c.ranges).every(([f, s]) => (person[f] as number) >= s.lo && (person[f] as number) <= s.hi));
}
