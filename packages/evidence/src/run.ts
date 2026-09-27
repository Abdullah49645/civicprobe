import type { ComparisonConfig, ResultState, VersionAttribution } from "../../shared/src/result.js";
import type { Comparison } from "../../comparator/src/compare.js";
import type { ScheduleDelta } from "../../delta-engine/src/schedule-delta.js";
import type { ConditionDelta } from "../../delta-engine/src/condition-delta.js";
import type { ProbePlan, ProbeRationale, Strategy } from "../../generator/src/plan.js";
import type { ShrinkResult, RecordShrinkResult } from "../../generator/src/shrink.js";
import type { Discovery, TargetDescriptor, TraceStep, ObservationStatus } from "../../service-adapters/src/types.js";
import type { PolicyRule } from "../../policy-engine/src/types.js";
import type { Diagnosis } from "../../pipeline/src/diagnose.js";

/**
 * A Run is the unit of evidence. The UI is a view over Run objects and
 * nothing else: every number it shows is computed from these records.
 *
 * Identity vs metadata:
 *  - `identity` is content-addressed. runId = hash(spec) where spec covers the
 *    policy rule hashes, delta, plan, adapter id+version, target, comparison
 *    config and generator version+seed. Re-running the same spec yields the
 *    same runId on any machine.
 *  - `resultDigest` = hash of (probe id, executed input, observed value,
 *    result) for every execution in order. Same behaviour => same digest.
 *    The in-browser replay recomputes it and compares.
 *  - `environment` (timestamps, browser version, durations) is recorded but
 *    deliberately excluded from both hashes.
 */

export const RUN_SCHEMA = "civicprobe.run/2";

export interface PolicyRef {
  id: string;
  title: string;
  ruleHash: string;
  recordHash: string;
  record: PolicyRule;
}

export interface Execution {
  seq: number;
  phase: "plan" | "shrink";
  probeId: string;
  strategy: Strategy | "shrink";
  rationale: ProbeRationale;
  inAffectedRegion: boolean;
  requestedInput: Record<string, number>;
  executedInput: Record<string, number>;
  expected: string;
  expectedOld: string;
  derivation: string;
  observation: {
    status: ObservationStatus;
    value: string | null;
    rawText: string;
    detail?: string;
    steps: TraceStep[];
    screenshotRef?: string;
  };
  result: ResultState;
  reason: string;
  comparison?: Comparison;
  attribution?: VersionAttribution;
  components: string[];
}

export interface Finding {
  id: string;
  /** Where the discrepancies sit, in policy terms. */
  region: string;
  /** Edits in force at these inputs (not necessarily the culprit; see Run.diagnosis). */
  components: string[];
  executions: number[];
  attribution: VersionAttribution | "MIXED";
  summary: string;
}

export interface Counterexample {
  input: Record<string, number>;
  /** The first plan probe (in execution order) that detected a discrepancy. */
  foundBy: { seq: number; strategy: string; input: Record<string, number> };
  /** Where shrinking started (the smallest discrepant input for schedules). */
  shrinkStart: Record<string, number>;
  expected: string;
  observed: string | null;
  seq: number;
  certificate: ShrinkResult["certificate"] | RecordShrinkResult["certificate"];
  statement: string;
  shrinkExecutions: number;
  trace: { x: Record<string, number>; fails: boolean; phase: string }[];
}

export interface Run {
  schema: typeof RUN_SCHEMA;
  identity: {
    runId: string;
    specHash: string;
    target: TargetDescriptor;
    adapter: { id: string; version: string; kind: string };
    oldPolicy: Omit<PolicyRef, "record">;
    newPolicy: Omit<PolicyRef, "record">;
    deltaId: string;
    planId: string;
    generator: ProbePlan["generator"];
    seed: number;
    comparison: ComparisonConfig | { kind: "categorical" };
    comparisonJustification: string;
  };
  policies: { old: PolicyRef; new: PolicyRef };
  delta: ScheduleDelta | ConditionDelta;
  plan: ProbePlan;
  discovery: Discovery;
  executions: Execution[];
  summary: {
    planned: number;
    executed: number;
    shrinkExecutions: number;
    counts: Record<ResultState, number>;
    verdict: ResultState;
    verdictText: string;
  };
  findings: Finding[];
  /** Which single edit (if any) explains every observation. Null when nothing disagreed. */
  diagnosis: Diagnosis | null;
  counterexample: Counterexample | null;
  resultDigest: string;
  screenshots: Record<string, string>;
  environment: {
    runner: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    blockedRequests: string[];
    pageLoads: number | null;
  };
  replay: { command: string };
}

/** Public phrasing per state. Never asserts a legal violation. */
export function reportingLanguage(result: ResultState): string {
  switch (result) {
    case "DISCREPANCY":
      return "Candidate policy/service discrepancy: the observed service output differs from the configured policy oracle under the stated comparison rules.";
    case "CONFORMANT":
      return "The observed service output conforms to the configured policy oracle under the stated comparison rules.";
    case "UNDETERMINED":
      return "The service answered, but its output could not be read unambiguously; no conclusion is drawn.";
    case "ASSUMPTION_MISMATCH":
      return "The service's inputs or outputs do not match the oracle's stated assumptions, so the comparison would not be meaningful; no conclusion is drawn.";
    case "NOT_UPDATED":
      return "The service indicates it does not offer the tested policy version; nothing was compared.";
    case "EXECUTION_FAILURE":
      return "The probe could not be executed reliably. This is a technical failure, not a finding about the law or the service.";
  }
}
