import { Rational } from "../../shared/src/rational.js";
import type { ComparisonConfig, ResultState, RoundingMode, VersionAttribution } from "../../shared/src/result.js";

/**
 * Deterministic comparison. The engine — never an LLM, never a heuristic in
 * the UI — decides CONFORMANT vs DISCREPANCY, and only from:
 *   expected (exact rational from the NEW oracle),
 *   observed (the decimal string the adapter read off the page),
 *   an explicit ComparisonConfig (no defaults).
 * Rounding is applied identically to both sides, exactly (no floats).
 */

export interface NumericComparison {
  kind: "numeric";
  expected: string;
  expectedOld: string | null;
  observed: string;
  rounding: RoundingMode;
  roundedExpected: string;
  roundedObserved: string;
  absoluteError: string;
  withinTolerance: boolean;
  result: Extract<ResultState, "CONFORMANT" | "DISCREPANCY">;
  attribution: VersionAttribution;
  reason: string;
}

export interface CategoricalComparison {
  kind: "categorical";
  expected: string;
  expectedOld: string | null;
  observed: string;
  result: Extract<ResultState, "CONFORMANT" | "DISCREPANCY">;
  attribution: VersionAttribution;
  reason: string;
}

export type Comparison = NumericComparison | CategoricalComparison;

export function roundExact(v: Rational, mode: RoundingMode): Rational {
  switch (mode) {
    case "none":
      return v;
    case "floor":
      return Rational.of(v.floor());
    case "ceil":
      return Rational.of(v.ceil());
    case "half-up":
      // Round half away from zero (what a calculator showing whole rupees does).
      return v.sign() >= 0 ? Rational.of(v.add(Rational.of(1n, 2n)).floor()) : Rational.of(v.sub(Rational.of(1n, 2n)).ceil());
  }
}

function within(a: Rational, b: Rational, cfg: ComparisonConfig): { ok: boolean; err: Rational } {
  const err = a.sub(b).abs();
  const tol = Rational.parse(String(cfg.absoluteTolerance));
  let ok = err.cmp(tol) <= 0;
  if (ok && cfg.relativeTolerance !== undefined && !b.isZero()) {
    ok = err.div(b.abs()).cmp(Rational.parse(String(cfg.relativeTolerance))) <= 0;
  }
  return { ok, err };
}

export function compareNumeric(expected: Rational, observed: string, cfg: ComparisonConfig, expectedOld?: Rational): NumericComparison {
  if (cfg == null || cfg.rounding == null || cfg.absoluteTolerance == null) throw new Error("compareNumeric: an explicit ComparisonConfig is required");
  const obs = Rational.parse(observed);
  const re = roundExact(expected, cfg.rounding);
  const ro = roundExact(obs, cfg.rounding);
  const { ok, err } = within(ro, re, cfg);
  let matchesOld = false;
  if (expectedOld) matchesOld = within(ro, roundExact(expectedOld, cfg.rounding), cfg).ok;
  const attribution: VersionAttribution = ok ? (matchesOld ? "MATCHES_BOTH" : "MATCHES_NEW") : matchesOld ? "MATCHES_OLD" : "MATCHES_NEITHER";
  const tolText = `tolerance ${cfg.absoluteTolerance}${cfg.relativeTolerance !== undefined ? ` and ${cfg.relativeTolerance * 100}% relative` : ""}, rounding ${cfg.rounding}`;
  return {
    kind: "numeric",
    expected: expected.toDecimalString(),
    expectedOld: expectedOld ? expectedOld.toDecimalString() : null,
    observed,
    rounding: cfg.rounding,
    roundedExpected: re.toDecimalString(),
    roundedObserved: ro.toDecimalString(),
    absoluteError: err.toDecimalString(),
    withinTolerance: ok,
    result: ok ? "CONFORMANT" : "DISCREPANCY",
    attribution,
    reason: ok
      ? `|${ro.toDecimalString()} − ${re.toDecimalString()}| = ${err.toDecimalString()} is within ${tolText}.`
      : `|${ro.toDecimalString()} − ${re.toDecimalString()}| = ${err.toDecimalString()} exceeds ${tolText}.` +
        (attribution === "MATCHES_OLD" ? " The observed value equals the superseded version's output." : ""),
  };
}

export function compareCategorical(expected: string, observed: string, expectedOld?: string): CategoricalComparison {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const ok = norm(expected) === norm(observed);
  const matchesOld = expectedOld !== undefined && norm(expectedOld) === norm(observed);
  const attribution: VersionAttribution = ok ? (matchesOld ? "MATCHES_BOTH" : "MATCHES_NEW") : matchesOld ? "MATCHES_OLD" : "MATCHES_NEITHER";
  return {
    kind: "categorical",
    expected,
    expectedOld: expectedOld ?? null,
    observed,
    result: ok ? "CONFORMANT" : "DISCREPANCY",
    attribution,
    reason: ok
      ? `Observed "${observed}" equals expected "${expected}" (case- and whitespace-insensitive).`
      : `Observed "${observed}", expected "${expected}".` + (attribution === "MATCHES_OLD" ? " The observed outcome equals the superseded version's outcome." : ""),
  };
}
