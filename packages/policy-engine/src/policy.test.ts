import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Rational } from "../../shared/src/rational.js";
import { sha256Hex } from "../../shared/src/hash.js";
import { continuityReport, evaluate, evaluateExact, rowFor, validateSchedule, evaluateEligibility } from "./evaluate.js";
import { PK_SALARY_TAX_NEW as NEW, PK_SALARY_TAX_OLD as OLD } from "../../../fixtures/policies/pk-salary-tax.js";
import { FEE_WAIVER_NEW } from "../../../fixtures/policies/fee-waiver.js";
import type { ProgressiveSchedule } from "./types.js";

test("statutory boundary semantics: 'exceeds X but does not exceed Y' is (X, Y]", () => {
  assert.equal(rowFor(NEW, Rational.of(600_000)).row, "S. No. 1");
  assert.equal(rowFor(NEW, Rational.of(600_001)).row, "S. No. 2");
  assert.equal(rowFor(NEW, Rational.of(7_000_000)).row, "S. No. 7");
  assert.equal(rowFor(NEW, Rational.of(7_000_001)).row, "S. No. 8");
  assert.equal(rowFor(NEW, Rational.of(0)).row, "S. No. 1");
});

test("surcharge applies only when income EXCEEDS the threshold", () => {
  assert.equal(evaluate(OLD, 10_000_000), 2_681_000);
  assert.ok(evaluateExact(OLD, 10_000_001).eq(Rational.parse("2681000.35").mul(Rational.parse("1.09"))));
});

test("validateSchedule rejects gaps, overlaps, bad rates and a bounded last row", () => {
  const bad = (rows: ProgressiveSchedule["rows"]) => () => validateSchedule({ ...NEW, rows });
  assert.throws(bad([{ row: "a", over: 0, upTo: 10, base: 0, rate: "0" }, { row: "b", over: 20, upTo: null, base: 0, rate: "0.1" }]));
  assert.throws(bad([{ row: "a", over: 0, upTo: 10, base: 0, rate: "1.5" }, { row: "b", over: 10, upTo: null, base: 0, rate: "0.1" }]));
  assert.throws(bad([{ row: "a", over: 0, upTo: 10, base: 0, rate: "0" }]));
  validateSchedule(NEW);
  validateSchedule(OLD);
});

test("encoding self-check: both real tables are internally continuous", () => {
  assert.deepEqual(continuityReport(OLD), []);
  assert.deepEqual(continuityReport(NEW), []);
});

test("encoding self-check catches a transcription typo in a fixed amount", () => {
  const typo = { ...NEW, rows: NEW.rows.map((r) => (r.row === "S. No. 6" ? { ...r, base: 514_000 } : r)) };
  const rep = continuityReport(typo);
  assert.equal(rep.length, 2);
  assert.equal(rep[0].row, "S. No. 6");
  assert.equal(rep[0].expectedBase, "541000");
});

for (const p of [OLD, NEW]) {
  test(`source linkage (${p.id}): committed excerpt hash matches, and the excerpt's table parses to exactly the encoded rows`, () => {
    const ex = p.provenance.authority.excerpt!;
    const text = readFileSync(ex.path, "utf8");
    assert.equal(sha256Hex(text), ex.sha256, "excerpt file changed without updating the policy's declared hash");
    const rows = text
      .split("\n")
      .filter((l) => /^\d+ \|/.test(l))
      .map((l) => {
        const [sno, cond, rate] = l.split("|").map((s) => s.trim());
        const nums = (s: string) => [...s.matchAll(/Rs\. ([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
        const c = nums(cond);
        const pct = /(\d+)%/.exec(rate)![1];
        const base = /^Rs\. ([\d,]+) plus/.exec(rate);
        return {
          row: `S. No. ${sno}`,
          over: cond.includes("does not exceed") && !cond.includes("exceeds Rs") ? 0 : c[0],
          upTo: cond.includes("does not exceed") ? c[c.length - 1] : null,
          base: base ? Number(base[1].replace(/,/g, "")) : 0,
          rate: Rational.of(Number(pct), 100).toDecimalString(),
        };
      });
    assert.deepEqual(rows, p.rows.map((r) => ({ ...r, rate: Rational.parse(r.rate).toDecimalString() })));
  });
}

test("eligibility evaluation", () => {
  assert.equal(evaluateEligibility(FEE_WAIVER_NEW, { age: 60, income: 1_500_000 }), "Eligible");
  assert.equal(evaluateEligibility(FEE_WAIVER_NEW, { age: 59, income: 0 }), "Not eligible");
  assert.equal(evaluateEligibility(FEE_WAIVER_NEW, { age: 70, income: 1_500_001 }), "Not eligible");
});
