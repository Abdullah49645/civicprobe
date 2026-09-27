import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScheduleDelta } from "../../delta-engine/src/schedule-delta.js";
import { computeConditionDelta } from "../../delta-engine/src/condition-delta.js";
import { boundaryOnlyPlan, gridPlan, planConditionProbes, planScheduleProbes, randomPlan } from "./plan.js";
import { shrink1D, shrinkRecord } from "./shrink.js";
import { PK_SALARY_TAX_NEW as NEW, PK_SALARY_TAX_OLD as OLD } from "../../../fixtures/policies/pk-salary-tax.js";
import { FEE_WAIVER_NEW, FEE_WAIVER_OLD } from "../../../fixtures/policies/fee-waiver.js";

const delta = computeScheduleDelta(OLD, NEW);

test("plan determinism: same inputs → identical plan id, probe ids and order; different seed → different plan", () => {
  const a = planScheduleProbes(delta, OLD, NEW);
  const b = planScheduleProbes(computeScheduleDelta(OLD, NEW), OLD, NEW);
  assert.equal(a.id, b.id);
  assert.deepEqual(a.probes.map((p) => p.id), b.probes.map((p) => p.id));
  assert.notEqual(planScheduleProbes(delta, OLD, NEW, { seed: 1 }).id, a.id);
  assert.equal(new Set(a.probes.map((p) => p.id)).size, a.probes.length, "probe ids unique");
});

test("plan: divergence witnesses come first, one per affected open cell, at the end where |NEW−OLD| is largest", () => {
  const p = planScheduleProbes(delta, OLD, NEW);
  const w = p.probes.filter((x) => x.strategy === "divergence-witness");
  assert.equal(w.length, delta.cells.filter((c) => c.kind === "open" && c.affected).length);
  assert.ok(p.probes.slice(0, w.length).every((x) => x.strategy === "divergence-witness"));
  assert.equal(w[0].input.income, 3_199_999); // |d| grows 0 → 30,000 across S. No. 4
});

test("plan: every changed threshold gets T and T+1 probes; every probe carries a rationale; controls are outside the region", () => {
  const p = planScheduleProbes(delta, OLD, NEW);
  const xs = new Set(p.probes.map((x) => x.input.income));
  for (const t of [2_200_000, 3_200_000, 4_100_000, 5_600_000, 7_000_000, 10_000_000]) {
    assert.ok(xs.has(t) && xs.has(t + 1), `boundary probes at ${t}`);
  }
  assert.ok(p.probes.every((x) => x.rationale.summary.length > 10));
  assert.ok(p.probes.filter((x) => x.strategy === "control").every((x) => !x.inAffectedRegion));
  assert.ok(p.probes.filter((x) => ["divergence-witness", "interior", "delta-random"].includes(x.strategy)).every((x) => x.inAffectedRegion));
});

test("baselines are deterministic and delta-free", () => {
  assert.deepEqual(randomPlan("income", 5, 100, 3).probes.map((p) => p.input.income), randomPlan("income", 5, 100, 3).probes.map((p) => p.input.income));
  assert.deepEqual(gridPlan("income", 4, 100).probes.map((p) => p.input.income), [25, 50, 75, 100]);
  const b = boundaryOnlyPlan("income", OLD, NEW);
  assert.equal(b.probes[0].input.income, 599_999);
  assert.equal(b.deltaId, null);
});

test("eligibility plan covers every affected cell exactly once with a witness", () => {
  const d = computeConditionDelta(FEE_WAIVER_OLD, FEE_WAIVER_NEW);
  const p = planConditionProbes(d);
  assert.equal(p.probes.filter((x) => x.strategy === "divergence-witness").length, d.cells.filter((c) => c.affected).length);
});

const pred = (f: (x: number) => boolean) => async (x: number) => f(x);

test("shrink: monotone predicate → exact minimum with exhaustive certificate", async () => {
  const r = await shrink1D(pred((x) => x >= 4_100_001), 9_000_000, { min: 0, anchors: [4_100_000] });
  assert.equal(r.value, 4_100_001);
});

test("shrink: NON-MONOTONE rounding predicate (stale 30% vs 25%, whole-rupee display, tol 1) → true first failure, not a later transition", async () => {
  const T = 3_200_000;
  const round = (v: number) => Math.floor(v + 0.5);
  const fails = (x: number) => x > T && x <= 4_100_000 && Math.abs(round(316000 + 0.3 * (x - T)) - round(316000 + 0.25 * (x - T))) > 1;
  let truth = T + 1;
  while (!fails(truth)) truth++;
  const r = await shrink1D(pred(fails), 4_099_999, { min: 0, anchors: [2_200_000, T, 4_100_000] });
  assert.equal(r.value, truth);
  assert.equal(r.certificate, "exhaustive-above-fence");
  // Audit the certificate from the trace itself.
  const tested = new Map(r.trace.map((s) => [s.x, s.fails]));
  for (let x = r.fence! + 1; x < r.value; x++) assert.equal(tested.get(x), false, `x=${x} should have been executed and passed`);
});

test("shrink: disconnected narrow band below a wide failing region is found via structural anchors", async () => {
  // Band (4,100,000, 4,101,000] fails; everything above 7,000,000 fails; nothing else.
  const fails = (x: number) => (x > 4_100_000 && x <= 4_101_000) || x > 7_000_000;
  const r = await shrink1D(pred(fails), 9_000_000, { min: 0, anchors: [4_100_000, 7_000_000] });
  assert.equal(r.value, 4_100_001);
});

test("shrink: bisection alone would be wrong here — documents why anchors matter", async () => {
  const fails = (x: number) => (x > 4_100_000 && x <= 4_101_000) || x > 7_000_000;
  const r = await shrink1D(pred(fails), 9_000_000, { min: 0, anchors: [] });
  assert.equal(r.value, 7_000_001, "without structure, the narrow band is invisible — hence the certificate says what was proved");
  assert.equal(r.certificate, "one-minimal");
});

test("shrink: refuses a non-failing start; handles a failing domain minimum", async () => {
  await assert.rejects(shrink1D(pred(() => false), 10, { min: 0, anchors: [] }));
  assert.equal((await shrink1D(pred(() => true), 10, { min: 0, anchors: [] })).certificate, "at-domain-minimum");
});

test("shrinkRecord: two interacting fields (fails iff a ≥ 60 AND b ≤ 1,500,000 AND a < 65) → (60, 0) and coordinate-minimal", async () => {
  const f = async (x: Record<string, number>) => x.a >= 60 && x.a < 65 && x.b <= 1_500_000;
  const r = await shrinkRecord(f, { a: 64, b: 1_400_000 }, [
    { name: "a", simplest: 0, anchors: [60, 65] },
    { name: "b", simplest: 0, anchors: [1_200_000, 1_500_000] },
  ]);
  assert.deepEqual(r.value, { a: 60, b: 0 });
});

test("shrinkRecord: interaction that needs a second round (b can only shrink after a shrinks)", async () => {
  const f = async (x: Record<string, number>) => x.a + x.b >= 100 && x.b >= x.a;
  const r = await shrinkRecord(f, { a: 90, b: 90 }, [
    { name: "a", simplest: 0, anchors: [] },
    { name: "b", simplest: 0, anchors: [] },
  ]);
  assert.ok(await f(r.value));
  assert.ok(!(await f({ ...r.value, a: r.value.a - 1 })) || r.value.a === 0);
  assert.ok(!(await f({ ...r.value, b: r.value.b - 1 })));
});
