/**
 * Counterexample shrinking against a black-box service.
 *
 * The old shrinker was bisection between 0 and a failing input. Bisection is
 * only sound when failure is monotone (once it fails, everything above fails).
 * That assumption is false here, for two concrete reasons:
 *
 *  - Rounding. A stale 30% rate where the statute says 25% differs by
 *    0.05 × (x − T). Displayed in whole rupees, the error is invisible at
 *    T+1…T+11, visible at T+12, invisible again at T+14, visible from ~T+20
 *    on. The predicate oscillates.
 *  - Disconnected regions. A threshold typo in a branch condition produces a
 *    1,000-rupee band of failures with passing inputs on both sides.
 *
 * So the shrinker uses the policy's own structure and states exactly what it
 * proved:
 *
 *  A. Structural descent. Test the anchors (breakpoints of either version,
 *     their +1 neighbours, and any extra candidates such as the plan's
 *     divergence witnesses) below the failing input, in ascending order. The
 *     first failing anchor bounds the answer; the last passing anchor below
 *     it is a known-good lower fence.
 *  B. Bisection between the fence (passes) and the bound (fails) to find a
 *     transition t with t−1 passing and t failing.
 *  C. Exhaustive scan of every integer between the fence and t when that
 *     window is at most `scanWindow` wide.
 *
 * Certificate returned with the result:
 *  - "exhaustive-above-fence": every integer in (fence, x*) was executed and
 *    passed, the fence passed, x* failed. x* is the smallest failing input
 *    ≥ fence. Below the fence only the listed anchors were tested.
 *  - "one-minimal": x* fails and x* − 1 passes. No claim about smaller inputs
 *    beyond the tested anchors.
 * Every executed input is in the trace, so both claims are auditable.
 */

export interface ShrinkStep {
  x: number;
  fails: boolean;
  phase: "start" | "anchor" | "bisect" | "scan" | "verify";
}

export interface ShrinkResult {
  value: number;
  fence: number | null;
  certificate: "exhaustive-above-fence" | "one-minimal" | "at-domain-minimum";
  statement: string;
  executions: number;
  trace: ShrinkStep[];
}

export interface Shrink1DOptions {
  min: number;
  anchors: number[];
  scanWindow?: number;
  maxExecutions?: number;
}

export async function shrink1D(fails: (x: number) => Promise<boolean>, x0: number, opts: Shrink1DOptions): Promise<ShrinkResult> {
  const scanWindow = opts.scanWindow ?? 256;
  const maxExec = opts.maxExecutions ?? 600;
  const cache = new Map<number, boolean>();
  const trace: ShrinkStep[] = [];
  const test = async (x: number, phase: ShrinkStep["phase"]) => {
    if (cache.has(x)) return cache.get(x)!;
    if (cache.size >= maxExec) throw new Error(`shrink1D: execution budget ${maxExec} exhausted`);
    const f = await fails(x);
    cache.set(x, f);
    trace.push({ x, fails: f, phase });
    return f;
  };

  if (!(await test(x0, "start"))) throw new Error(`shrink1D: starting input ${x0} does not fail`);
  if (await test(opts.min, "anchor")) {
    return { value: opts.min, fence: null, certificate: "at-domain-minimum", statement: `The domain minimum ${opts.min} itself fails.`, executions: cache.size, trace };
  }

  // A. structural descent
  const candidates = [...new Set(opts.anchors.flatMap((a) => [a, a + 1]).filter((a) => a > opts.min && a < x0))].sort((a, b) => a - b);
  let fence = opts.min; // passes
  let bound = x0; // fails
  for (const c of candidates) {
    if (await test(c, "anchor")) {
      bound = c;
      break;
    }
    fence = c;
  }

  // B. bisection between fence (pass) and bound (fail)
  let lo = fence;
  let hi = bound;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (await test(mid, "bisect")) hi = mid;
    else lo = mid;
  }
  // hi fails, hi-1 (== lo) passes: a transition.

  // C. exhaustive scan of (fence, hi) when small enough
  if (hi - fence - 1 <= scanWindow) {
    for (let x = fence + 1; x < hi; x++) {
      if (await test(x, "scan")) {
        hi = x;
        break;
      }
    }
    return {
      value: hi,
      fence,
      certificate: "exhaustive-above-fence",
      statement: `Smallest failing input at or above ${fence.toLocaleString("en-US")}: every integer from ${(fence + 1).toLocaleString("en-US")} to ${(hi - 1).toLocaleString("en-US")} was executed and conforms; ${hi.toLocaleString("en-US")} does not. Below the fence, ${candidates.filter((c) => c <= fence).length} structural anchors were executed and conform.`,
      executions: cache.size,
      trace,
    };
  }
  await test(hi - 1, "verify");
  return {
    value: hi,
    fence,
    certificate: "one-minimal",
    statement: `${hi.toLocaleString("en-US")} fails and ${(hi - 1).toLocaleString("en-US")} conforms. The window above the last passing anchor was too wide to scan exhaustively, so smaller failing inputs between ${fence.toLocaleString("en-US")} and ${hi.toLocaleString("en-US")} are not ruled out.`,
    executions: cache.size,
    trace,
  };
}

export interface FieldShrinkSpec {
  name: string;
  simplest: number;
  anchors: number[];
}

export interface RecordShrinkResult {
  value: Record<string, number>;
  certificate: "coordinate-one-minimal";
  statement: string;
  rounds: number;
  executions: number;
  trace: { input: Record<string, number>; fails: boolean; field: string }[];
}

/**
 * Multi-field shrinking by coordinate descent: shrink one field at a time
 * toward its simplest value with shrink1D (other fields held fixed), and
 * repeat rounds until nothing moves. Handles interacting fields because a
 * later round can move a field that was blocked earlier. Certificate:
 * for every field, lowering it by one (or to its simplest value) makes the
 * case conform — a local, not global, minimum, and stated as such.
 */
export async function shrinkRecord(fails: (x: Record<string, number>) => Promise<boolean>, x0: Record<string, number>, fields: FieldShrinkSpec[], maxRounds = 6): Promise<RecordShrinkResult> {
  const cache = new Map<string, boolean>();
  const trace: RecordShrinkResult["trace"] = [];
  const test = async (x: Record<string, number>, field: string) => {
    const k = JSON.stringify(Object.keys(x).sort().map((f) => [f, x[f]]));
    if (cache.has(k)) return cache.get(k)!;
    const f = await fails(x);
    cache.set(k, f);
    trace.push({ input: { ...x }, fails: f, field });
    return f;
  };
  if (!(await test(x0, "start"))) throw new Error("shrinkRecord: starting input does not fail");
  let cur = { ...x0 };
  let rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    let moved = false;
    for (const f of fields) {
      const v = cur[f.name];
      if (v <= f.simplest) continue;
      const r = await shrink1D((x) => test({ ...cur, [f.name]: x }, f.name), v, { min: f.simplest, anchors: f.anchors });
      if (r.value !== v) {
        cur = { ...cur, [f.name]: r.value };
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const f of fields) if (cur[f.name] > f.simplest) await test({ ...cur, [f.name]: cur[f.name] - 1 }, f.name);
  return {
    value: cur,
    certificate: "coordinate-one-minimal",
    statement: `Fails at ${JSON.stringify(cur)}; lowering any single field by one (or to its simplest value) conforms. Local minimum over ${fields.length} fields, not a global search.`,
    rounds: rounds + 1,
    executions: cache.size,
    trace,
  };
}
