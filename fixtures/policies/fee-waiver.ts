/**
 * DEMO FIXTURE ONLY — an invented rule. No government enacted this, no
 * TARGET_DOSSIER entry backs it, and nothing derived from it may be presented
 * as a real-world finding.
 *
 * Purpose: exercise the second rule family (boolean eligibility over several
 * integer fields) end to end with a genuinely different service shape
 * (a screener that answers "Eligible" / "Not eligible"), so the claim
 * "the pipeline is not tax-specific" is demonstrated rather than asserted.
 * Two fields change at once, so the affected region is two-dimensional and
 * the counterexample shrinker has to work across fields.
 *
 * Invented premise: a senior utility-fee waiver whose qualifying age drops
 * from 65 to 60 while the household-income cap rises from 1.2M to 1.5M.
 */
import type { EligibilityRule, FieldSpec, Provenance } from "../../packages/policy-engine/src/types.js";

const FIELDS: FieldSpec[] = [
  { name: "age", label: "Age", unit: "years", kind: "integer", min: 0, max: 120, simplest: 0 },
  { name: "income", label: "Annual household income", unit: "PKR", kind: "integer", min: 0, max: 5_000_000, simplest: 0 },
];

const FIXTURE_PROVENANCE: Provenance = {
  status: "FIXTURE",
  statusReason: "Invented for this repository to exercise the eligibility rule family. Not a real policy.",
  authority: {
    id: "civicprobe-demo-fixture",
    kind: "fixture",
    title: "CivicProbe demo fixture (invented policy)",
    publisher: "CivicProbe",
    url: "about:fixture",
    retrievedAt: "2026-09-26",
  },
  corroboration: [],
};

export const FEE_WAIVER_OLD: EligibilityRule = {
  kind: "eligibility-rule",
  id: "demo-fee-waiver-v1",
  title: "Senior fee waiver v1 (demo fixture)",
  jurisdiction: "Invented",
  fields: FIELDS,
  outcomes: { whenTrue: "Eligible", whenFalse: "Not eligible" },
  condition: {
    kind: "and",
    conditions: [
      { kind: "cmp", field: "age", op: ">=", value: 65 },
      { kind: "cmp", field: "income", op: "<=", value: 1_200_000 },
    ],
  },
  effective: { from: "2025-01-01", to: "2025-12-31", label: "v1" },
  assumptions: ["Invented rule. Age in completed years; income is annual household income in PKR."],
  provenance: FIXTURE_PROVENANCE,
};

export const FEE_WAIVER_NEW: EligibilityRule = {
  ...FEE_WAIVER_OLD,
  id: "demo-fee-waiver-v2",
  title: "Senior fee waiver v2 (demo fixture)",
  condition: {
    kind: "and",
    conditions: [
      { kind: "cmp", field: "age", op: ">=", value: 60 },
      { kind: "cmp", field: "income", op: "<=", value: 1_500_000 },
    ],
  },
  effective: { from: "2026-01-01", label: "v2" },
};
