import { test } from "node:test";
import assert from "node:assert/strict";
import { Rational } from "../../shared/src/rational.js";
import { mulberry32 } from "../../shared/src/random.js";
import { evaluateExact, evaluateEligibility } from "../../policy-engine/src/evaluate.js";
import type { EligibilityRule, ProgressiveSchedule, ScheduleRow } from "../../policy-engine/src/types.js";
import { computeScheduleDelta, inAffected, parseRat } from "./schedule-delta.js";
import { computeConditionDelta, cellOf } from "./condition-delta.js";
import { PK_SALARY_TAX_NEW as NEW, PK_SALARY_TAX_OLD as OLD } from "../../../fixtures/policies/pk-salary-tax.js";
import { FEE_WAIVER_NEW, FEE_WAIVER_OLD } from "../../../fixtures/policies/fee-waiver.js";

const mk = (id: string, rows: [number, number | null, number, string][], surcharge?: [number, string]): ProgressiveSchedule => ({
  ...NEW,
  id,
  rows: rows.map(([over, upTo, base, rate], i): ScheduleRow => ({ row: `r${i + 1}`, over, upTo, base, rate })),
  surcharge: surcharge ? { row: "s", over: surcharge[0], rateOnTax: surcharge[1] } : undefined,
});
const differs = (a: ProgressiveSchedule, b: ProgressiveSchedule, x: number) => !evaluateExact(a, x).eq(evaluateExact(b, x));
const iv = (d: ReturnType<typeof computeScheduleDelta>) => d.affected.map((i) => `${i.loClosed ? "[" : "("}${i.lo},${i.hi ?? "∞"}${i.hiClosed ? "]" : ")"}`);

test("PK: affected region is exactly (2,200,000, ∞), open at 2,200,000, no coincidental equalities", () => {
  const d = computeScheduleDelta(OLD, NEW);
  assert.deepEqual(iv(d), ["(2200000,∞)"]);
  assert.deepEqual(d.equalityPoints, []);
  assert.equal(inAffected(d, 2_200_000), false);
  assert.equal(inAffected(d, 2_200_001), true);
});

test("PK: 11 statute-level components, including the withdrawn surcharge and two new thresholds", () => {
  const d = computeScheduleDelta(OLD, NEW);
  assert.equal(d.components.length, 11);
  assert.deepEqual(d.components.filter((c) => c.kind === "threshold-introduced").map((c) => c.at), [5_600_000, 7_000_000]);
  assert.ok(d.components.some((c) => c.kind === "surcharge-removed" && c.at === 10_000_000));
});

test("adversarial: surcharge threshold moved 1,000 → 2,000 gives (1000, 2000] — bounded, closed at 2000", () => {
  const a = mk("a", [[0, null, 0, "0.1"]], [1000, "0.05"]);
  const b = mk("b", [[0, null, 0, "0.1"]], [2000, "0.05"]);
  assert.deepEqual(iv(computeScheduleDelta(a, b)), ["(1000,2000]"]);
});

test("adversarial: surcharge removed gives (T, ∞), open at T (surcharge needs income to EXCEED T)", () => {
  const a = mk("a", [[0, null, 0, "0.1"]], [1000, "0.05"]);
  const b = mk("b", [[0, null, 0, "0.1"]]);
  assert.deepEqual(iv(computeScheduleDelta(a, b)), ["(1000,∞)"]);
});

test("adversarial: crossing formulas — equal at exactly one point, reported as an equality point", () => {
  const a = mk("a", [[0, null, 0, "0.1"]]);
  const b = mk("b", [[0, 100, 0, "0"], [100, null, 0, "0.2"]]); // 0.2(x-100) = 0.1x at x = 200
  const d = computeScheduleDelta(a, b);
  assert.deepEqual(d.equalityPoints, ["200"]);
  assert.equal(inAffected(d, 200), false);
  assert.equal(inAffected(d, 199), true);
  assert.equal(inAffected(d, 201), true);
  assert.equal(inAffected(d, 0), false);
});

test("adversarial: identical versions → empty region; bracket split with identical formula → empty region", () => {
  assert.deepEqual(computeScheduleDelta(NEW, NEW).affected, []);
  const a = mk("a", [[0, 100, 0, "0"], [100, null, 0, "0.1"]]);
  const b = mk("b", [[0, 100, 0, "0"], [100, 500, 0, "0.1"], [500, null, 40, "0.1"]]);
  assert.deepEqual(computeScheduleDelta(a, b).affected, []);
});

test("adversarial: rate change inside a bounded band only (bases hard-coded) → bounded region", () => {
  const a = mk("a", [[0, 100, 0, "0.1"], [100, 200, 10, "0.2"], [200, null, 30, "0.3"]]);
  const b = mk("b", [[0, 100, 0, "0.1"], [100, 200, 10, "0.25"], [200, null, 30, "0.3"]]);
  // New is discontinuous at 200 (35 → 30): still exact.
  assert.deepEqual(iv(computeScheduleDelta(a, b)), ["(100,200]"]);
});

test("PROPERTY: on 200 random pairs of schedules (random rows, bases, rates, surcharges), inAffected(x) ⇔ OLD(x) ≠ NEW(x) at every breakpoint, ±1, and random points", () => {
  const rng = mulberry32(99);
  const randSchedule = (id: string): ProgressiveSchedule => {
    const k = 1 + Math.floor(rng() * 5);
    const cuts = [...new Set(Array.from({ length: k - 1 }, () => 10 * (1 + Math.floor(rng() * 100))))].sort((x, y) => x - y);
    const bounds = [0, ...cuts];
    const rows: [number, number | null, number, string][] = bounds.map((lo, i) => [lo, i + 1 < bounds.length ? bounds[i + 1] : null, Math.floor(rng() * 50), (Math.floor(rng() * 5) / 10).toFixed(1)]);
    return mk(id, rows, rng() < 0.4 ? [10 * Math.floor(rng() * 110), (Math.floor(rng() * 3) / 10).toFixed(1)] : undefined);
  };
  let checked = 0;
  for (let t = 0; t < 200; t++) {
    const a = randSchedule("a");
    const b = rng() < 0.2 ? { ...a, id: "b" } : randSchedule("b");
    const d = computeScheduleDelta(a, b);
    const pts = new Set<number>();
    for (const bp of d.breakpoints) for (const o of [-1, 0, 1]) if (bp.x + o >= 0) pts.add(bp.x + o);
    for (let i = 0; i < 40; i++) pts.add(Math.floor(rng() * 1500));
    for (const z of d.equalityPoints) { const r = parseRat(z); if (r.isInteger()) pts.add(Number(r.n)); }
    for (const x of pts) {
      assert.equal(inAffected(d, x), differs(a, b, x), `trial ${t}, x=${x}`);
      checked++;
    }
    // Non-integer points too: the region is exact over the reals.
    for (let i = 0; i < 10; i++) {
      const x = Rational.of(BigInt(Math.floor(rng() * 150000)), 100n);
      const inside = d.affected.some((iv) => {
        const c1 = x.cmp(parseRat(iv.lo));
        if (c1 < 0 || (c1 === 0 && !iv.loClosed)) return false;
        if (iv.hi === null) return true;
        const c2 = x.cmp(parseRat(iv.hi));
        return c2 < 0 || (c2 === 0 && iv.hiClosed);
      });
      assert.equal(inside, !evaluateExact(a, x).eq(evaluateExact(b, x)));
    }
  }
  assert.ok(checked > 5000);
});

test("condition delta: fee waiver affected cells are exactly the inputs whose outcome changed (exhaustive over a grid)", () => {
  const d = computeConditionDelta(FEE_WAIVER_OLD, FEE_WAIVER_NEW);
  for (let age = 0; age <= 120; age += 1) {
    for (const income of [0, 1, 1_199_999, 1_200_000, 1_200_001, 1_499_999, 1_500_000, 1_500_001, 5_000_000]) {
      const p = { age, income };
      assert.equal(cellOf(d, p)!.affected, evaluateEligibility(FEE_WAIVER_OLD, p) !== evaluateEligibility(FEE_WAIVER_NEW, p), JSON.stringify(p));
    }
  }
  assert.deepEqual(d.criticalValues, { age: [60, 65], income: [1_200_000, 1_500_000] });
});

test("condition delta PROPERTY: random nested and/or/not rules over two fields agree with brute force", () => {
  const rng = mulberry32(5);
  const fields = [
    { name: "a", label: "A", kind: "integer" as const, min: 0, max: 30, simplest: 0 },
    { name: "b", label: "B", kind: "integer" as const, min: 0, max: 30, simplest: 0 },
  ];
  const ops = ["<", "<=", ">", ">=", "==", "!="] as const;
  const leaf = () => ({ kind: "cmp" as const, field: rng() < 0.5 ? "a" : "b", op: ops[Math.floor(rng() * 6)], value: Math.floor(rng() * 31) });
  const tree = (depth: number): EligibilityRule["condition"] => {
    if (depth === 0 || rng() < 0.3) return leaf();
    const r = rng();
    if (r < 0.2) return { kind: "not", condition: tree(depth - 1) };
    return { kind: r < 0.6 ? "and" : "or", conditions: [tree(depth - 1), tree(depth - 1)] };
  };
  for (let t = 0; t < 60; t++) {
    const base = { ...FEE_WAIVER_OLD, fields };
    const o = { ...base, condition: tree(3) };
    const n = { ...base, id: "n", condition: tree(3) };
    const d = computeConditionDelta(o, n);
    for (let a = 0; a <= 30; a++) for (let b = 0; b <= 30; b++) {
      const p = { a, b };
      assert.equal(cellOf(d, p)!.affected, evaluateEligibility(o, p) !== evaluateEligibility(n, p));
    }
  }
});
