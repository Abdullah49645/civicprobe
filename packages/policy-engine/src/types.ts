/**
 * CivicProbe Policy IR.
 *
 * Two rule families, deliberately narrow:
 *
 *  1. ProgressiveSchedule — a statutory tax table over ONE numeric input,
 *     encoded with the statute's own boundary wording: a row applies when the
 *     input "exceeds `over` but does not exceed `upTo`", i.e. the half-open
 *     interval (over, upTo]. The first row is [0, upTo]. Tax in a row is
 *     `base + rate * (x - over)`. An optional surcharge multiplies the whole
 *     tax by (1 + rateOnTax) when x "exceeds" its threshold (strictly).
 *     Rates are exact decimal strings ("0.29"), never floats.
 *
 *  2. EligibilityRule — a boolean condition tree over a few bounded integer
 *     fields, comparing fields to constants. This is the family where the
 *     exact cell-decomposition delta (delta-engine/condition-delta.ts) applies.
 *
 * Neither family claims to model "the law". Each rule encodes one narrowly
 * scoped provision with explicit provenance and assumptions.
 */

export type SourceKind =
  | "enacted-statute"
  | "consolidated-statute"
  | "bill"
  | "professional-analysis"
  | "secondary-publication"
  | "fixture";

export interface SourceReference {
  id: string;
  kind: SourceKind;
  title: string;
  publisher: string;
  url: string;
  retrievedAt: string;
  /** Where in the document the encoded provision lives. */
  locator?: string;
  /** SHA-256 of the downloaded artifact itself (PDF bytes). Absent = not yet hashed. */
  artifactSha256?: string;
  /** A verbatim excerpt of the encoded provision committed to this repo, and its hash. */
  excerpt?: { path: string; sha256: string };
  note?: string;
}

export type ProvenanceStatus =
  /** Authority is an enacted/consolidated statute whose artifact bytes are hashed. */
  | "LOCKED"
  /** Encoded values independently corroborated by >=1 post-enactment source, artifact not hashed. */
  | "CORROBORATED"
  /** Invented for a demo fixture. Never a real-world oracle. */
  | "FIXTURE";

export interface Provenance {
  status: ProvenanceStatus;
  statusReason: string;
  authority: SourceReference;
  corroboration: SourceReference[];
}

export interface ScheduleRow {
  /** The statute's own row label, e.g. "S. No. 6". */
  row: string;
  /** Exclusive lower bound (the row applies when x exceeds this). First row: 0, inclusive. */
  over: number;
  /** Inclusive upper bound, or null for the open-ended top row. */
  upTo: number | null;
  /** Fixed amount, integer PKR. */
  base: number;
  /** Marginal rate on the amount exceeding `over`, as an exact decimal string. */
  rate: string;
}

export interface Surcharge {
  row: string;
  /** Applies when x strictly exceeds this. */
  over: number;
  /** Fraction of the computed tax, exact decimal string (e.g. "0.09"). */
  rateOnTax: string;
}

export interface EffectivePeriod {
  from: string;
  to?: string;
  label: string;
}

export interface ProgressiveSchedule {
  kind: "progressive-schedule";
  id: string;
  title: string;
  jurisdiction: string;
  input: { name: string; label: string; unit: string; min: number };
  output: { name: string; label: string; unit: string };
  effective: EffectivePeriod;
  rows: ScheduleRow[];
  surcharge?: Surcharge;
  assumptions: string[];
  provenance: Provenance;
}

export type Scalar = string | number | boolean;

export type Condition =
  | { kind: "cmp"; field: string; op: "<" | "<=" | ">" | ">=" | "==" | "!="; value: number }
  | { kind: "in"; field: string; values: Scalar[] }
  | { kind: "and"; conditions: Condition[] }
  | { kind: "or"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };

export interface FieldSpec {
  name: string;
  label: string;
  unit?: string;
  kind: "integer";
  min: number;
  max: number;
  /** The value shrinking moves toward ("simplest" citizen). */
  simplest: number;
}

export interface EligibilityRule {
  kind: "eligibility-rule";
  id: string;
  title: string;
  jurisdiction: string;
  fields: FieldSpec[];
  outcomes: { whenTrue: string; whenFalse: string };
  condition: Condition;
  effective: EffectivePeriod;
  assumptions: string[];
  provenance: Provenance;
}

export type PolicyRule = ProgressiveSchedule | EligibilityRule;
export type PersonAttributes = Record<string, Scalar>;
