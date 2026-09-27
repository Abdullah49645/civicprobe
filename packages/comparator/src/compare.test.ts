import { test } from "node:test";
import assert from "node:assert/strict";
import { Rational } from "../../shared/src/rational.js";
import { compareCategorical, compareNumeric, roundExact } from "./compare.js";

const cfg = { rounding: "half-up" as const, absoluteTolerance: 1 };

test("rounding is exact half-up (316002.5 → 316003), identical on both sides", () => {
  assert.equal(roundExact(Rational.parse("316002.5"), "half-up").toString(), "316003");
  assert.equal(roundExact(Rational.parse("316002.49"), "half-up").toString(), "316002");
});

test("tolerance is inclusive: error of exactly 1 conforms, 2 does not", () => {
  assert.equal(compareNumeric(Rational.of(100), "101", cfg).result, "CONFORMANT");
  assert.equal(compareNumeric(Rational.of(100), "102", cfg).result, "DISCREPANCY");
  assert.equal(compareNumeric(Rational.of(0), "0", { rounding: "none", absoluteTolerance: 0 }).result, "CONFORMANT");
});

test("attribution: an observed value equal to the OLD version's output is reported as MATCHES_OLD", () => {
  const c = compareNumeric(Rational.of(541_000), "616000", cfg, Rational.of(616_000));
  assert.equal(c.result, "DISCREPANCY");
  assert.equal(c.attribution, "MATCHES_OLD");
  assert.equal(compareNumeric(Rational.of(6_000), "6000", cfg, Rational.of(6_000)).attribution, "MATCHES_BOTH");
});

test("relative tolerance must ALSO hold", () => {
  const c = compareNumeric(Rational.of(1_000_000), "1050000", { rounding: "none", absoluteTolerance: 100_000, relativeTolerance: 0.01 });
  assert.equal(c.result, "DISCREPANCY");
});

test("no default config: missing config throws; non-decimal observed throws", () => {
  // @ts-expect-error deliberate
  assert.throws(() => compareNumeric(Rational.of(1), "1", undefined));
  assert.throws(() => compareNumeric(Rational.of(1), "1e3", cfg));
});

test("categorical comparison is case/whitespace-insensitive and attributes to the old version", () => {
  assert.equal(compareCategorical("Not eligible", "  not   ELIGIBLE ").result, "CONFORMANT");
  const c = compareCategorical("Eligible", "Not eligible", "Not eligible");
  assert.equal(c.result, "DISCREPANCY");
  assert.equal(c.attribution, "MATCHES_OLD");
});
