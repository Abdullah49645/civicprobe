/**
 * The closed vocabulary of outcomes CivicProbe is allowed to report.
 * There is no boolean "passed" anywhere in the codebase — every comparison
 * produces exactly one of these, with its reason attached.
 *
 *  CONFORMANT          observed == oracle(NEW) under the stated comparison config
 *  DISCREPANCY         observed != oracle(NEW) under the stated comparison config,
 *                      with a successful, unambiguous observation
 *  UNDETERMINED        the service answered but the answer could not be read
 *                      unambiguously (unparseable / ambiguous output)
 *  ASSUMPTION_MISMATCH the service's inputs/outputs do not match the oracle's
 *                      stated assumptions (e.g. monthly vs annual), so no
 *                      comparison is meaningful
 *  NOT_UPDATED         the service itself indicates it does not offer the tested
 *                      policy version (e.g. no "2026-27" option)
 *  EXECUTION_FAILURE   the probe could not be executed (timeout, navigation error,
 *                      missing element, rate cap). Never evidence about the law.
 */
export type ResultState =
  | "CONFORMANT"
  | "DISCREPANCY"
  | "UNDETERMINED"
  | "ASSUMPTION_MISMATCH"
  | "NOT_UPDATED"
  | "EXECUTION_FAILURE";

export const RESULT_STATES: ResultState[] = [
  "CONFORMANT",
  "DISCREPANCY",
  "UNDETERMINED",
  "ASSUMPTION_MISMATCH",
  "NOT_UPDATED",
  "EXECUTION_FAILURE",
];

export type RoundingMode = "none" | "half-up" | "floor" | "ceil";

/** Every numeric comparison requires one of these. There is no default. */
export interface ComparisonConfig {
  /** Rounding applied identically to expected and observed before comparing. */
  rounding: RoundingMode;
  /** Absolute tolerance in the outcome's own unit (PKR), inclusive. */
  absoluteTolerance: number;
  /** Optional relative tolerance (fraction of |expected|), inclusive. Both must hold. */
  relativeTolerance?: number;
}

/**
 * Which policy version, if any, the observation is consistent with. This is
 * evidence for a human, not a new result state: a DISCREPANCY whose observed
 * value equals the OLD version's output is "consistent with the superseded
 * rule", which is much more actionable than "wrong".
 */
export type VersionAttribution = "MATCHES_NEW" | "MATCHES_OLD" | "MATCHES_BOTH" | "MATCHES_NEITHER";
