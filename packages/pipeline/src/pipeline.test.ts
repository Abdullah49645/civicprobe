import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRun } from "./run.js";
import { SCENARIOS, inProcessAdapterFor, specFor } from "../../../fixtures/scenarios.js";
import type { Observation, ServiceAdapter } from "../../service-adapters/src/types.js";
import { reportingLanguage } from "../../evidence/src/run.js";

const S = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const fixedClock = () => new Date("2026-09-26T00:00:00Z");
const run = (id: string, adapter?: ServiceAdapter) => executeRun({ ...specFor(S(id), "in-process"), screenshots: false }, adapter ?? inProcessAdapterFor(S(id)), { now: fixedClock });

test("reproducibility: the same spec twice → identical runId, planId, digest and byte-identical evidence", async () => {
  const a = await run("tax-stale-rate");
  const b = await run("tax-stale-rate");
  assert.equal(a.identity.runId, b.identity.runId);
  assert.equal(a.resultDigest, b.resultDigest);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("identity separates computation from behaviour: a different seeded fault keeps the plan but changes run id and digest", async () => {
  const a = await run("tax-stale-rate");
  const b = await run("tax-correct");
  assert.equal(a.plan.id, b.plan.id);
  assert.notEqual(a.identity.runId, b.identity.runId);
  assert.notEqual(a.resultDigest, b.resultDigest);
});

test("correct implementation: every planned probe CONFORMANT, no counterexample, verdict CONFORMANT", async () => {
  const r = await run("tax-correct");
  assert.equal(r.summary.counts.CONFORMANT, r.summary.planned);
  assert.equal(r.summary.verdict, "CONFORMANT");
  assert.equal(r.counterexample, null);
});

test("each seeded tax fault is detected, shrunk with a certificate, and the counterexample really fails", async () => {
  for (const id of ["tax-stale-rate", "tax-legacy-surcharge", "tax-missing-band", "tax-ignores-year", "tax-branch-typo"]) {
    const r = await run(id);
    assert.equal(r.summary.verdict, "DISCREPANCY", id);
    const ce = r.counterexample!;
    assert.ok(ce, id);
    assert.equal(r.executions[ce.seq].result, "DISCREPANCY", id);
    const below = r.executions.find((e) => e.executedInput.income === ce.input.income - 1);
    assert.ok(below && below.result === "CONFORMANT", `${id}: x*-1 must have been executed and conform`);
  }
});

test("attribution: 'ignores the tax year' is attributed to the superseded TY2026 rule everywhere it disagrees", async () => {
  const r = await run("tax-ignores-year");
  assert.ok(r.findings.length > 0);
  assert.ok(r.findings.every((f) => f.attribution === "MATCHES_OLD"));
});

test("legacy surcharge is localised to the withdrawn-surcharge component and to inputs above 10,000,000", async () => {
  const r = await run("tax-legacy-surcharge");
  const d = r.executions.filter((e) => e.result === "DISCREPANCY");
  assert.ok(d.every((e) => e.executedInput.income > 10_000_000));
  assert.equal(r.counterexample!.input.income > 10_000_000, true);
  const surchargeId = (r.delta as { components: { id: string; kind: string }[] }).components.find((c) => c.kind === "surcharge-removed")!.id;
  assert.ok(d.every((e) => e.components.includes(surchargeId)));
});

test("NOT_UPDATED: the service does not offer 2026-27 → every probe NOT_UPDATED and ZERO requests were made", async () => {
  const a = inProcessAdapterFor(S("tax-not-updated"));
  const r = await run("tax-not-updated", a);
  assert.equal(r.summary.counts.NOT_UPDATED, r.summary.planned);
  assert.equal(a.calls, 0);
  assert.equal(r.summary.verdict, "NOT_UPDATED");
});

function stub(obs: (i: Record<string, number>) => Observation): ServiceAdapter {
  const base = inProcessAdapterFor(S("tax-correct"));
  return { descriptor: base.descriptor, discover: () => base.discover(), execute: async (i) => obs(i), close: async () => {} };
}

test("execution failures are EXECUTION_FAILURE — never converted into a discrepancy", async () => {
  const r = await run("tax-correct", stub(() => ({ status: "timeout", value: null, rawText: "", steps: [], detail: "simulated" })));
  assert.equal(r.summary.counts.EXECUTION_FAILURE, r.summary.planned);
  assert.equal(r.summary.counts.DISCREPANCY, 0);
  assert.equal(r.summary.verdict, "EXECUTION_FAILURE");
  assert.equal(r.counterexample, null);
});

test("unreadable output → UNDETERMINED; unit mismatch → ASSUMPTION_MISMATCH; neither is a discrepancy", async () => {
  const u = await run("tax-correct", stub(() => ({ status: "unparseable", value: null, rawText: "Rs. 12 or Rs. 13", steps: [] })));
  assert.equal(u.summary.verdict, "UNDETERMINED");
  const m = await run("tax-correct", stub(() => ({ status: "assumption_mismatch", value: null, rawText: "monthly tax Rs. 100", steps: [] })));
  assert.equal(m.summary.verdict, "ASSUMPTION_MISMATCH");
  assert.equal(m.summary.counts.DISCREPANCY, 0);
});

test("every execution carries a complete provenance chain: source → rule → delta → probe → expected → observed → comparison", async () => {
  const r = await run("tax-stale-rate");
  assert.ok(r.policies.new.record.provenance.authority.url.startsWith("https://"));
  assert.match(r.identity.newPolicy.ruleHash, /^[0-9a-f]{64}$/);
  for (const e of r.executions) {
    assert.ok(e.probeId.startsWith("probe_"));
    assert.ok(e.rationale.summary);
    assert.ok(e.derivation.includes("S. No."));
    assert.ok(e.observation.steps.length > 0);
    if (e.result === "CONFORMANT" || e.result === "DISCREPANCY") assert.ok(e.comparison);
  }
  assert.ok(!/illegal|violat|breaking the law/i.test(reportingLanguage("DISCREPANCY")));
});

test("eligibility (2 fields): stale age threshold localised to age 60–64, counterexample shrunk to (60, 0), attributed to the old rule", async () => {
  const r = await run("waiver-stale-age");
  assert.deepEqual(r.counterexample!.input, { age: 60, income: 0 });
  assert.ok(r.executions.filter((e) => e.result === "DISCREPANCY").every((e) => e.executedInput.age >= 60 && e.executedInput.age <= 64 && e.executedInput.income <= 1_500_000));
  assert.equal(r.findings[0].attribution, "MATCHES_OLD");
});

test("diagnosis: each seeded single-edit fault is explained by exactly the edit that was left stale", async () => {
  const expect: Record<string, string> = { "tax-stale-rate": "stale-rate:S. No. 5", "tax-legacy-surcharge": "legacy-surcharge:>", "tax-missing-band": "missing-threshold:7000000", "tax-ignores-year": "stale-table", "waiver-stale-age": "stale:C1" };
  for (const [id, h] of Object.entries(expect)) {
    const r = await run(id);
    assert.deepEqual(r.diagnosis!.consistent.map((x) => x.id), [h], id);
  }
  const typo = await run("tax-branch-typo");
  assert.ok(typo.diagnosis!.consistent.length > 0 && typo.diagnosis!.consistent.every((x) => x.id.startsWith("typo:4100000:+")));
  assert.equal((await run("tax-correct")).diagnosis, null);
});
