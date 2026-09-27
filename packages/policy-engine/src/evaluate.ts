import { Rational } from "../../shared/src/rational.js";
import { assert } from "../../shared/src/assert.js";
import { canonicalJson, contentId, sha256Hex } from "../../shared/src/hash.js";
import type { Condition, EligibilityRule, PersonAttributes, ProgressiveSchedule, ScheduleRow } from "./types.js";

/** Rows sorted, contiguous, first starts at 0, last is open-ended, rates in [0,1]. */
export function validateSchedule(p: ProgressiveSchedule): void {
  const rows = p.rows;
  assert(rows.length > 0, `${p.id}: schedule has no rows`);
  assert(rows[0].over === 0, `${p.id}: first row must start at 0`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rate = Rational.parse(r.rate);
    assert(rate.sign() >= 0 && rate.cmp(Rational.ONE) <= 0, `${p.id} ${r.row}: rate ${r.rate} outside [0,1]`);
    assert(Number.isSafeInteger(r.base) && r.base >= 0, `${p.id} ${r.row}: base must be a non-negative integer`);
    if (i < rows.length - 1) {
      assert(r.upTo !== null, `${p.id} ${r.row}: only the last row may be open-ended`);
      assert(r.upTo > r.over, `${p.id} ${r.row}: empty row`);
      assert(rows[i + 1].over === r.upTo, `${p.id}: rows ${r.row} and ${rows[i + 1].row} are not contiguous (${r.upTo} vs ${rows[i + 1].over})`);
    } else {
      assert(r.upTo === null, `${p.id}: last row must be open-ended`);
    }
  }
  if (p.surcharge) {
    const s = Rational.parse(p.surcharge.rateOnTax);
    assert(s.sign() >= 0, `${p.id}: negative surcharge`);
  }
}

/**
 * Encoding self-check. Real progressive tables are continuous: each row's
 * fixed base equals the previous row's tax at its upper bound. If a
 * transcribed base amount disagrees with the transcribed rates, one of them
 * was copied wrong. Returns the rows where continuity fails (empty = the
 * transcription is internally consistent). This does not prove the table
 * matches the statute; it catches a whole class of transcription errors
 * without any external source.
 */
export function continuityReport(p: ProgressiveSchedule): { row: string; expectedBase: string; encodedBase: number }[] {
  const out: { row: string; expectedBase: string; encodedBase: number }[] = [];
  for (let i = 1; i < p.rows.length; i++) {
    const prev = p.rows[i - 1];
    const expected = rowTax(prev, Rational.of(prev.upTo as number));
    if (!expected.eq(Rational.of(p.rows[i].base))) {
      out.push({ row: p.rows[i].row, expectedBase: expected.toDecimalString(), encodedBase: p.rows[i].base });
    }
  }
  return out;
}

/** The row that applies to x under the statute's "(over, upTo]" semantics. */
export function rowFor(p: ProgressiveSchedule, x: Rational): ScheduleRow {
  assert(x.sign() >= 0, `${p.id}: input must be non-negative`);
  for (let i = 0; i < p.rows.length; i++) {
    const r = p.rows[i];
    const aboveLower = i === 0 ? x.cmp(Rational.of(r.over)) >= 0 : x.cmp(Rational.of(r.over)) > 0;
    const belowUpper = r.upTo === null || x.cmp(Rational.of(r.upTo)) <= 0;
    if (aboveLower && belowUpper) return r;
  }
  throw new Error(`${p.id}: no row covers ${x.toString()}`);
}

function rowTax(r: ScheduleRow, x: Rational): Rational {
  return Rational.of(r.base).add(Rational.parse(r.rate).mul(x.sub(Rational.of(r.over))));
}

export function surchargeApplies(p: ProgressiveSchedule, x: Rational): boolean {
  return !!p.surcharge && x.cmp(Rational.of(p.surcharge.over)) > 0;
}

/** Exact evaluation. */
export function evaluateExact(p: ProgressiveSchedule, x: Rational | number): Rational {
  const xr = x instanceof Rational ? x : Rational.of(x);
  const base = rowTax(rowFor(p, xr), xr);
  if (p.surcharge && surchargeApplies(p, xr)) {
    return base.mul(Rational.ONE.add(Rational.parse(p.surcharge.rateOnTax)));
  }
  return base;
}

/** Evaluation to a JS number, for comparison against an observed value. */
export function evaluate(p: ProgressiveSchedule, x: number): number {
  return evaluateExact(p, x).toNumber();
}

/** Human-readable derivation of one evaluation, for the evidence chain. */
export function explain(p: ProgressiveSchedule, x: number): string {
  const xr = Rational.of(x);
  const r = rowFor(p, xr);
  const base = rowTax(r, xr);
  let s = `${p.effective.label}, ${r.row}: ${fmt(r.base)} + ${pct(r.rate)} × (${fmt(x)} − ${fmt(r.over)}) = ${base.toDecimalString()}`;
  if (p.surcharge && surchargeApplies(p, xr)) {
    const total = base.mul(Rational.ONE.add(Rational.parse(p.surcharge.rateOnTax)));
    s += `; surcharge ${pct(p.surcharge.rateOnTax)} (income exceeds ${fmt(p.surcharge.over)}) → ${total.toDecimalString()}`;
  }
  return s;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function pct(rate: string): string {
  return `${Rational.parse(rate).mul(Rational.of(100)).toDecimalString()}%`;
}

// ---------------------------------------------------------------------------
// Eligibility rules

export function evaluateCondition(c: Condition, person: PersonAttributes): boolean {
  switch (c.kind) {
    case "cmp": {
      const v = person[c.field];
      assert(typeof v === "number", `field ${c.field} must be numeric, got ${JSON.stringify(v)}`);
      switch (c.op) {
        case "<": return v < c.value;
        case "<=": return v <= c.value;
        case ">": return v > c.value;
        case ">=": return v >= c.value;
        case "==": return v === c.value;
        case "!=": return v !== c.value;
      }
    }
    // eslint-disable-next-line no-fallthrough
    case "in":
      return c.values.includes(person[c.field]);
    case "and":
      return c.conditions.every((x) => evaluateCondition(x, person));
    case "or":
      return c.conditions.some((x) => evaluateCondition(x, person));
    case "not":
      return !evaluateCondition(c.condition, person);
  }
}

export function evaluateEligibility(rule: EligibilityRule, person: PersonAttributes): string {
  return evaluateCondition(rule.condition, person) ? rule.outcomes.whenTrue : rule.outcomes.whenFalse;
}

export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case "cmp": return `${c.field} ${c.op} ${c.value.toLocaleString("en-US")}`;
    case "in": return `${c.field} ∈ {${c.values.join(", ")}}`;
    case "and": return c.conditions.map(describeCondition).join(" AND ");
    case "or": return "(" + c.conditions.map(describeCondition).join(" OR ") + ")";
    case "not": return `NOT (${describeCondition(c.condition)})`;
  }
}

// ---------------------------------------------------------------------------
// Identity

/** Hash of the rule's semantics only (what it computes), excluding provenance prose. */
export function ruleHash(p: ProgressiveSchedule | EligibilityRule): string {
  const semantic =
    p.kind === "progressive-schedule"
      ? { kind: p.kind, input: p.input, output: p.output, rows: p.rows, surcharge: p.surcharge ?? null }
      : { kind: p.kind, fields: p.fields, outcomes: p.outcomes, condition: p.condition };
  return sha256Hex(canonicalJson(semantic));
}

/** Hash of the full policy record including provenance and assumptions. */
export function policyRecordHash(p: ProgressiveSchedule | EligibilityRule): string {
  return sha256Hex(canonicalJson(p));
}

export function ruleId(p: ProgressiveSchedule | EligibilityRule): string {
  return contentId("rule", { id: p.id, h: ruleHash(p) });
}
