import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Rational } from "./rational.js";
import { canonicalJson, sha256Hex } from "./hash.js";
import { mulberry32 } from "./random.js";

test("Rational: exact decimal arithmetic where floats fail", () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.notEqual(0.07 * 100, 7);
  assert.ok(Rational.parse("0.11").mul(Rational.of(1_000_000)).eq(Rational.of(110_000)));
  assert.equal(Rational.parse("0.1").add(Rational.parse("0.2")).toDecimalString(), "0.3");
});

test("Rational: floor/ceil/sign on negatives and fractions", () => {
  assert.equal(Rational.of(-7n, 2n).floor(), -4n);
  assert.equal(Rational.of(-7n, 2n).ceil(), -3n);
  assert.equal(Rational.of(7n, 2n).floor(), 3n);
  assert.equal(Rational.of(6n, 3n).toString(), "2");
  assert.equal(Rational.of(1n, 3n).toDecimalString(), "1/3");
  assert.throws(() => Rational.parse("1e5"));
  assert.throws(() => Rational.of(1n, 0n));
});

test("sha256Hex matches node:crypto on 300 random inputs (including multi-byte UTF-8)", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 300; i++) {
    const len = Math.floor(rng() * 200);
    let s = "";
    for (let j = 0; j < len; j++) s += String.fromCharCode(32 + Math.floor(rng() * 0x2000));
    assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"));
  }
});

test("canonicalJson is key-order independent and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: undefined }] }), canonicalJson({ a: [2, { d: 3 }], b: 1 }));
  assert.throws(() => canonicalJson({ x: NaN }));
});

test("mulberry32 is deterministic", () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});
