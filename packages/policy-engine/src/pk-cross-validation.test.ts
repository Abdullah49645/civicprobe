import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluate.js";
import { PK_SALARY_TAX_NEW as NEW, PK_SALARY_TAX_OLD as OLD } from "../../../fixtures/policies/pk-salary-tax.js";

/**
 * Independent cross-validation of BOTH encoded versions against values
 * published by third parties, computed without this repository.
 *
 * KPMG Taseer Hadi & Co., "A Brief of Finance Act, 2026" (July 2026), p. 15:
 * annual salary → tax under the existing (TY2026) and new (TY2027) tables.
 * The 12,000,000 existing value includes the 9% s.4AB surcharge.
 */
const KPMG: [number, number, number][] = [
  [600_000, 0, 0],
  [1_200_000, 6_000, 6_000],
  [2_200_000, 116_000, 116_000],
  [3_200_000, 346_000, 316_000],
  [4_100_000, 616_000, 541_000],
  [5_600_000, 1_141_000, 976_000],
  [7_000_000, 1_631_000, 1_424_000],
  [10_000_000, 2_681_000, 2_474_000],
  [12_000_000, 3_685_290, 3_174_000],
];

test("TY2026 and TY2027 encodings reproduce all 9 KPMG worked values exactly", () => {
  for (const [income, existing, next] of KPMG) {
    assert.equal(evaluate(OLD, income), existing, `old @ ${income}`);
    assert.equal(evaluate(NEW, income), next, `new @ ${income}`);
  }
});

test("TY2026 encoding reproduces PakFiler's 5 published worked examples", () => {
  const ex: [number, number][] = [[1_200_000, 6_000], [1_800_000, 72_000], [2_400_000, 162_000], [3_600_000, 466_000], [6_000_000, 1_281_000]];
  for (const [income, tax] of ex) assert.equal(evaluate(OLD, income), tax);
});
