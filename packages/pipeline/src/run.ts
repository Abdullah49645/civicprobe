import { Rational } from "../../shared/src/rational.js";
import { canonicalJson, contentId, sha256Hex } from "../../shared/src/hash.js";
import type { ComparisonConfig, ResultState } from "../../shared/src/result.js";
import { RESULT_STATES } from "../../shared/src/result.js";
import { evaluateEligibility, evaluateExact, explain, policyRecordHash, ruleHash, validateSchedule, describeCondition } from "../../policy-engine/src/evaluate.js";
import type { EligibilityRule, ProgressiveSchedule } from "../../policy-engine/src/types.js";
import { computeScheduleDelta, componentsAt, parseRat, type ScheduleDelta } from "../../delta-engine/src/schedule-delta.js";
import { computeConditionDelta, cellOf, type ConditionDelta } from "../../delta-engine/src/condition-delta.js";
import { planConditionProbes, planScheduleProbes, type Probe, type ProbePlan, type SchedulePlanOptions } from "../../generator/src/plan.js";
import { shrink1D, shrinkRecord } from "../../generator/src/shrink.js";
import { compareCategorical, compareNumeric } from "../../comparator/src/compare.js";
import { RUN_SCHEMA, reportingLanguage, type Counterexample, type Execution, type Finding, type PolicyRef, type Run } from "../../evidence/src/run.js";
import type { Observation, ServiceAdapter } from "../../service-adapters/src/types.js";
import { diagnoseCondition, diagnoseSchedule } from "./diagnose.js";

export interface ScheduleRunSpec {
  family: "progressive-schedule";
  oldPolicy: ProgressiveSchedule;
  newPolicy: ProgressiveSchedule;
  comparison: ComparisonConfig;
  comparisonJustification: string;
  plan?: Partial<SchedulePlanOptions>;
  shrink: boolean;
  screenshots: boolean;
  runnerLabel: string;
  replayCommand: string;
}

export interface ConditionRunSpec {
  family: "eligibility-rule";
  oldPolicy: EligibilityRule;
  newPolicy: EligibilityRule;
  comparisonJustification: string;
  shrink: boolean;
  screenshots: boolean;
  runnerLabel: string;
  replayCommand: string;
}

export type RunSpec = ScheduleRunSpec | ConditionRunSpec;

/** Hooks for live progress (CLI / UI). Purely observational. */
export interface RunHooks {
  onPlanned?(plan: ProbePlan): void;
  onExecution?(e: Execution): void;
  now?: () => Date;
}

function project(input: Record<string, number>, lattice: Record<string, { step: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    const step = lattice[k]?.step ?? 1;
    out[k] = Math.ceil(v / step) * step;
  }
  return out;
}

function classify(obs: Observation): { state: ResultState | null; reason: string } {
  switch (obs.status) {
    case "ok":
      return { state: null, reason: "" };
    case "unparseable":
      return { state: "UNDETERMINED", reason: `Output could not be read unambiguously: ${obs.detail ?? ""}` };
    case "assumption_mismatch":
      return { state: "ASSUMPTION_MISMATCH", reason: obs.detail ?? "Service does not match the oracle's assumptions." };
    case "not_updated":
      return { state: "NOT_UPDATED", reason: obs.detail ?? "Service does not offer the tested version." };
    default:
      return { state: "EXECUTION_FAILURE", reason: `${obs.status}: ${obs.detail ?? ""}` };
  }
}

export async function executeRun(spec: RunSpec, adapter: ServiceAdapter, hooks: RunHooks = {}): Promise<Run> {
  const now = hooks.now ?? (() => new Date());
  const started = now();
  const isSchedule = spec.family === "progressive-schedule";

  // 1. Policy + delta + plan (pure, deterministic)
  let delta: ScheduleDelta | ConditionDelta;
  let plan: ProbePlan;
  if (spec.family === "progressive-schedule") {
    validateSchedule(spec.oldPolicy);
    validateSchedule(spec.newPolicy);
    delta = computeScheduleDelta(spec.oldPolicy, spec.newPolicy);
    plan = planScheduleProbes(delta, spec.oldPolicy, spec.newPolicy, spec.plan);
  } else {
    delta = computeConditionDelta(spec.oldPolicy, spec.newPolicy);
    plan = planConditionProbes(delta);
  }
  hooks.onPlanned?.(plan);

  const ref = (p: ProgressiveSchedule | EligibilityRule): PolicyRef => ({ id: p.id, title: p.title, ruleHash: ruleHash(p), recordHash: policyRecordHash(p), record: p });
  const oldRef = ref(spec.oldPolicy);
  const newRef = ref(spec.newPolicy);
  const comparison = spec.family === "progressive-schedule" ? spec.comparison : ({ kind: "categorical" } as const);
  const { record: _o, ...oldId } = oldRef;
  const { record: _n, ...newId } = newRef;
  const specBody = {
    schema: RUN_SCHEMA,
    oldRuleHash: oldRef.ruleHash,
    newRuleHash: newRef.ruleHash,
    deltaId: delta.id,
    planId: plan.id,
    adapter: { id: adapter.descriptor.id, version: adapter.descriptor.version },
    // A local fixture listens on an ephemeral port; its URL is not part of
    // what was tested. A live target's URL is.
    target: { ...adapter.descriptor.target, url: adapter.descriptor.target.nature === "LIVE_TARGET" ? adapter.descriptor.target.url : "local-fixture" },
    lattice: adapter.descriptor.inputLattice,
    comparison,
    shrink: spec.shrink,
  };
  const specHash = sha256Hex(canonicalJson(specBody));
  const runId = contentId("run", specHash, 16);

  // 2. Discovery
  const discovery = await adapter.discover();

  // 3. Oracle helpers
  const expectedOf = (input: Record<string, number>) => {
    if (spec.family === "progressive-schedule") {
      const x = input[spec.newPolicy.input.name];
      return {
        exactNew: evaluateExact(spec.newPolicy, x),
        exactOld: evaluateExact(spec.oldPolicy, x),
        expected: evaluateExact(spec.newPolicy, x).toDecimalString(),
        expectedOld: evaluateExact(spec.oldPolicy, x).toDecimalString(),
        derivation: explain(spec.newPolicy, x),
      };
    }
    const n = evaluateEligibility(spec.newPolicy, input);
    const o = evaluateEligibility(spec.oldPolicy, input);
    return { exactNew: null, exactOld: null, expected: n, expectedOld: o, derivation: `${spec.newPolicy.effective.label}: ${describeCondition(spec.newPolicy.condition)} → ${n}` };
  };
  const componentsFor = (input: Record<string, number>): string[] => {
    if (spec.family === "progressive-schedule") return componentsAt(delta as ScheduleDelta, input[spec.newPolicy.input.name], spec.oldPolicy, spec.newPolicy);
    const cell = cellOf(delta as ConditionDelta, input);
    if (!cell?.affected) return [];
    return (delta as ConditionDelta).components
      .filter((c) => {
        const f = c.field;
        const v = input[f];
        const nums = [c.old, c.new].map((s) => (s ? Number(s.replace(/[^0-9]/g, "")) : NaN)).filter((n) => !Number.isNaN(n));
        return nums.length === 2 && v >= Math.min(...nums) && v <= Math.max(...nums);
      })
      .map((c) => c.id);
  };

  const executions: Execution[] = [];
  const screenshotsWanted = spec.screenshots;
  const recordExecution = (probe: Probe | { id: string; strategy: "shrink"; input: Record<string, number>; rationale: Probe["rationale"]; inAffectedRegion: boolean }, executedInput: Record<string, number>, obs: Observation, phase: Execution["phase"]): Execution => {
    const exp = expectedOf(executedInput);
    const base = {
      seq: executions.length,
      phase,
      probeId: probe.id,
      strategy: probe.strategy,
      rationale: probe.rationale,
      inAffectedRegion: probe.inAffectedRegion,
      requestedInput: probe.input,
      executedInput,
      expected: exp.expected,
      expectedOld: exp.expectedOld,
      derivation: exp.derivation,
      observation: { status: obs.status, value: obs.value, rawText: obs.rawText, detail: obs.detail, steps: obs.steps },
      components: componentsFor(executedInput),
    };
    const cls = classify(obs);
    let e: Execution;
    if (cls.state) {
      e = { ...base, result: cls.state, reason: cls.reason };
    } else if (spec.family === "progressive-schedule") {
      try {
        const c = compareNumeric(exp.exactNew!, obs.value as string, spec.comparison, exp.exactOld!);
        e = { ...base, result: c.result, reason: c.reason, comparison: c, attribution: c.attribution };
      } catch (err) {
        e = { ...base, result: "UNDETERMINED", reason: `Observed value "${obs.value}" is not a decimal number: ${(err as Error).message}` };
      }
    } else {
      const c = compareCategorical(exp.expected, obs.value as string, exp.expectedOld);
      e = { ...base, result: c.result, reason: c.reason, comparison: c, attribution: c.attribution };
    }
    executions.push(e);
    hooks.onExecution?.(e);
    return e;
  };

  // 4. Execute the plan
  if (discovery.notUpdated) {
    for (const p of plan.probes) {
      const executedInput = project(p.input, adapter.descriptor.inputLattice);
      recordExecution(p, executedInput, { status: "not_updated", value: null, rawText: "", detail: discovery.notes.join(" "), steps: [] }, "plan");
    }
  } else {
    for (const p of plan.probes) {
      const executedInput = project(p.input, adapter.descriptor.inputLattice);
      const obs = await adapter.execute(executedInput);
      recordExecution(p, executedInput, obs, "plan");
    }
  }

  // 5. Shrink the lowest discrepancy (schedules) / the first (conditions)
  let counterexample: Counterexample | null = null;
  const discrepancies = executions.filter((e) => e.result === "DISCREPANCY");
  if (spec.shrink && discrepancies.length > 0) {
    const shrinkCache = new Map<string, Execution>();
    const failsAt = async (input: Record<string, number>): Promise<boolean> => {
      const key = canonicalJson(input);
      const prior = executions.find((e) => canonicalJson(e.executedInput) === key);
      if (prior) return prior.result === "DISCREPANCY";
      if (shrinkCache.has(key)) return shrinkCache.get(key)!.result === "DISCREPANCY";
      const obs = await adapter.execute(input);
      const pseudo = { id: contentId("probe", { deltaId: delta.id, input, strategy: "shrink" }), strategy: "shrink" as const, input, rationale: { summary: "Shrinking step: executed to narrow the counterexample." }, inAffectedRegion: false };
      const e = recordExecution(pseudo, input, obs, "shrink");
      shrinkCache.set(key, e);
      return e.result === "DISCREPANCY";
    };

    if (spec.family === "progressive-schedule") {
      const field = spec.newPolicy.input.name;
      const step = adapter.descriptor.inputLattice[field]?.step ?? 1;
      const start = discrepancies.reduce((a, b) => (b.executedInput[field] < a.executedInput[field] ? b : a));
      const anchors = [
        ...(delta as ScheduleDelta).breakpoints.map((b) => b.x),
        ...plan.probes.filter((p) => p.strategy === "divergence-witness" || p.strategy === "interior").map((p) => p.input[field]),
      ].map((a) => Math.ceil(a / step));
      const r = await shrink1D((k) => failsAt({ [field]: k * step }), start.executedInput[field] / step, { min: 0, anchors });
      const x = r.value * step;
      const final = executions.find((e) => e.executedInput[field] === x)!;
      counterexample = {
        input: { [field]: x },
        foundBy: { seq: discrepancies[0].seq, strategy: discrepancies[0].strategy, input: discrepancies[0].executedInput },
        shrinkStart: start.executedInput,
        expected: final.expected,
        observed: final.observation.value,
        seq: final.seq,
        certificate: r.certificate,
        statement: step === 1 ? r.statement : `${r.statement} (Inputs are restricted to multiples of ${step}; values above are lattice indices × ${step}.)`,
        shrinkExecutions: executions.filter((e) => e.phase === "shrink").length,
        trace: r.trace.map((t) => ({ x: { [field]: t.x * step }, fails: t.fails, phase: t.phase })),
      };
    } else {
      const start = discrepancies[0];
      const cd = delta as ConditionDelta;
      const fields = cd.fields.map((f) => ({ name: f.name, simplest: f.simplest, anchors: cd.criticalValues[f.name] }));
      const r = await shrinkRecord(failsAt, start.executedInput, fields);
      const key = canonicalJson(r.value);
      const final = executions.find((e) => canonicalJson(e.executedInput) === key)!;
      counterexample = {
        input: r.value,
        foundBy: { seq: start.seq, strategy: start.strategy, input: start.executedInput },
        shrinkStart: start.executedInput,
        expected: final.expected,
        observed: final.observation.value,
        seq: final.seq,
        certificate: r.certificate,
        statement: r.statement,
        shrinkExecutions: executions.filter((e) => e.phase === "shrink").length,
        trace: r.trace.map((t) => ({ x: t.input, fails: t.fails, phase: t.field })),
      };
    }
  }

  // 6. Screenshots: re-execute chosen cases and check the observation is unchanged.
  const screenshots: Record<string, string> = {};
  if (screenshotsWanted && !discovery.notUpdated) {
    const targets: Execution[] = [];
    if (counterexample) targets.push(executions[counterexample.seq]);
    const conf = executions.find((e) => e.result === "CONFORMANT" && e.inAffectedRegion);
    if (conf) targets.push(conf);
    for (const t of targets) {
      const obs = await adapter.execute(t.executedInput, { screenshot: true });
      if (obs.screenshotPngBase64 && obs.value === t.observation.value) {
        const refId = `shot_${t.probeId}`;
        screenshots[refId] = obs.screenshotPngBase64;
        t.observation.screenshotRef = refId;
      }
    }
  }

  // 7. Findings, grouped by policy region
  const findings: Finding[] = [];
  const disc = executions.filter((e) => e.result === "DISCREPANCY");
  if (spec.family === "progressive-schedule") {
    const sd = delta as ScheduleDelta;
    const field = spec.newPolicy.input.name;
    const groups = new Map<string, Execution[]>();
    for (const e of disc) {
      const x = e.executedInput[field];
      const cell = sd.cells.find((c) => {
        const lo = parseRat(c.lo);
        const xr = Rational.of(x);
        return c.kind === "point" ? xr.eq(lo) : xr.cmp(lo) > 0 && (c.hi === null || xr.cmp(parseRat(c.hi)) < 0);
      });
      const key = cell ? `${cell.newRow}` : "outside";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    for (const [row, es] of groups) {
      const attrs = new Set(es.map((e) => e.attribution));
      const comps = [...new Set(es.flatMap((e) => e.components))];
      const xs = es.map((e) => e.executedInput[field]);
      const attribution = attrs.size === 1 ? [...attrs][0]! : "MIXED";
      findings.push({
        id: contentId("finding", { runId, row, seqs: es.map((e) => e.seq) }),
        region: `${row}: ${es.length} discrepant input${es.length === 1 ? "" : "s"} between ${Math.min(...xs).toLocaleString("en-US")} and ${Math.max(...xs).toLocaleString("en-US")}`,
        components: comps,
        executions: es.map((e) => e.seq),
        attribution,
        summary:
          attribution === "MATCHES_OLD"
            ? `Every discrepant output in ${row} equals the superseded ${spec.oldPolicy.effective.label} rule. Consistent with ${comps.length ? comps.join(", ") : "these edits"} not being implemented.`
            : attribution === "MATCHES_NEITHER"
              ? `Outputs in ${row} match neither version. The service implements some third behaviour here.`
              : `Mixed: some discrepant outputs in ${row} match the old rule, some match neither.`,
      });
    }
  } else if (disc.length) {
    const attrs = new Set(disc.map((e) => e.attribution));
    const comps = [...new Set(disc.flatMap((e) => e.components))];
    const attribution = attrs.size === 1 ? [...attrs][0]! : "MIXED";
    findings.push({
      id: contentId("finding", { runId, seqs: disc.map((e) => e.seq) }),
      region: `${disc.length} discrepant input${disc.length === 1 ? "" : "s"} in the affected cells`,
      components: comps,
      executions: disc.map((e) => e.seq),
      attribution,
      summary: attribution === "MATCHES_OLD" ? `Every discrepant outcome equals the superseded ${spec.oldPolicy.effective.label} rule; consistent with ${comps.join(", ") || "the edit"} not being implemented.` : "Discrepant outcomes do not uniformly match the superseded rule.",
    });
  }

  // 8. Diagnosis (only when something disagreed)
  const diagnosis = disc.length === 0 ? null
    : spec.family === "progressive-schedule"
      ? diagnoseSchedule(spec.oldPolicy, spec.newPolicy, delta as ScheduleDelta, executions, spec.comparison, Number(plan.options.ceiling) || 12_000_000)
      : diagnoseCondition(spec.oldPolicy, spec.newPolicy, delta as ConditionDelta, executions);

  // 9. Summary + digest
  const counts = Object.fromEntries(RESULT_STATES.map((s) => [s, 0])) as Record<ResultState, number>;
  for (const e of executions.filter((e) => e.phase === "plan")) counts[e.result]++;
  const planExec = executions.filter((e) => e.phase === "plan");
  const verdict: ResultState =
    counts.DISCREPANCY > 0 ? "DISCREPANCY"
    : counts.NOT_UPDATED === planExec.length ? "NOT_UPDATED"
    : counts.CONFORMANT === planExec.length ? "CONFORMANT"
    : counts.EXECUTION_FAILURE === planExec.length ? "EXECUTION_FAILURE"
    : counts.ASSUMPTION_MISMATCH === planExec.length ? "ASSUMPTION_MISMATCH"
    : "UNDETERMINED";
  const resultDigest = sha256Hex(canonicalJson(executions.map((e) => [e.probeId, e.executedInput, e.observation.value, e.result])));
  const finished = now();

  return {
    schema: RUN_SCHEMA,
    identity: {
      runId,
      specHash,
      target: adapter.descriptor.target,
      adapter: { id: adapter.descriptor.id, version: adapter.descriptor.version, kind: adapter.descriptor.kind },
      oldPolicy: oldId,
      newPolicy: newId,
      deltaId: delta.id,
      planId: plan.id,
      generator: plan.generator,
      seed: plan.seed,
      comparison,
      comparisonJustification: spec.comparisonJustification,
    },
    policies: { old: oldRef, new: newRef },
    delta,
    plan,
    discovery,
    executions,
    summary: {
      planned: plan.probes.length,
      executed: planExec.length,
      shrinkExecutions: executions.length - planExec.length,
      counts,
      verdict,
      verdictText: reportingLanguage(verdict),
    },
    findings,
    diagnosis,
    counterexample,
    resultDigest,
    screenshots,
    environment: {
      runner: spec.runnerLabel,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      blockedRequests: "blockedRequests" in adapter ? [...((adapter as unknown as { blockedRequests: string[] }).blockedRequests)] : [],
      pageLoads: "pageLoads" in adapter ? (adapter as unknown as { pageLoads: number }).pageLoads : null,
    },
    replay: { command: spec.replayCommand },
  };
}
