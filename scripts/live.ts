/**
 * The ONLY entry point that touches a real external service. Manual,
 * human-run, never in CI. Read docs/responsible-testing.md first.
 *
 *   npm run live -- --target pakfiler                 discover only (default): prints what was found
 *   npm run live -- --target pakfiler --priority      discover + the target's priority probes only
 *   npm run live -- --target pakfiler --probe         discover + full delta-directed plan (+ shrink)
 *
 * Refuses to run if robots.txt disallows the path. Output: evidence/live/<target>-<date>.json,
 * disclosure state PRIVATE_FINDING. Paste the printed summary into docs/TARGET_DOSSIER.md §2.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "playwright";
import { FormAdapter } from "../packages/service-adapters/src/form-adapter.js";
import { robotsAllows } from "../packages/browser-runner/src/robots.js";
import { executeRun } from "../packages/pipeline/src/run.js";
import { compareNumeric } from "../packages/comparator/src/compare.js";
import { evaluateExact } from "../packages/policy-engine/src/evaluate.js";
import { LIVE_TARGETS } from "../fixtures/live-targets.js";
import { PK_COMPARISON, PK_COMPARISON_JUSTIFICATION } from "../fixtures/scenarios.js";
import { PK_SALARY_TAX_NEW, PK_SALARY_TAX_OLD } from "../fixtures/policies/pk-salary-tax.js";

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] ?? true : undefined);
const t = LIVE_TARGETS.find((x) => x.id === arg("target"));
if (!t) {
  console.error(`Usage: npm run live -- --target <${LIVE_TARGETS.map((x) => x.id).join("|")}> [--priority | --probe]`);
  process.exit(1);
}
const url = new URL(t.config.target.url);
const ctx = await request.newContext();
const robots = await ctx.get(`${url.origin}/robots.txt`).catch(() => null);
const robotsTxt = robots && robots.ok() ? await robots.text() : "";
await ctx.dispose();
if (!robotsAllows(robotsTxt, url.pathname)) {
  console.error(`robots.txt at ${url.origin} disallows ${url.pathname}. Not testing this target.`);
  process.exit(2);
}
console.log(`robots.txt: ${robotsTxt ? "allows" : "absent"} ${url.pathname}. Read the site's terms yourself before --probe.`);

const adapter = new FormAdapter(t.config);
const discovery = await adapter.discover();
console.log(JSON.stringify(discovery, null, 2));
if (!discovery.ok && !discovery.notUpdated) {
  console.error("Discovery did not find the form. Fix selectors in fixtures/live-targets.ts (inspect the page), then retry. Nothing was probed.");
  await adapter.close();
  process.exit(3);
}
mkdirSync("evidence/live", { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

if (arg("priority")) {
  const step = adapter.descriptor.inputLattice.income.step;
  for (const x0 of t.priorityProbes) {
    const x = Math.ceil(x0 / step) * step;
    const o = await adapter.execute({ income: x }, { screenshot: true });
    const res = o.status === "ok" && o.value !== null ? compareNumeric(evaluateExact(PK_SALARY_TAX_NEW, x), o.value, PK_COMPARISON, evaluateExact(PK_SALARY_TAX_OLD, x)) : null;
    console.log(`${x.toLocaleString("en-US").padStart(12)}  status=${o.status}  observed=${o.value}  expected=${evaluateExact(PK_SALARY_TAX_NEW, x).toDecimalString()}  → ${res ? `${res.result} (${res.attribution})` : "no comparison"}  "${o.rawText.slice(0, 80)}"`);
  }
} else if (arg("probe")) {
  const run = await executeRun(
    { family: "progressive-schedule", oldPolicy: PK_SALARY_TAX_OLD, newPolicy: PK_SALARY_TAX_NEW, comparison: PK_COMPARISON, comparisonJustification: PK_COMPARISON_JUSTIFICATION, plan: { ceiling: 12_000_000, randomFill: 0, controls: true, seed: 2026, tolerance: PK_COMPARISON.absoluteTolerance }, shrink: true, screenshots: true, runnerLabel: "live", replayCommand: `npm run live -- --target ${t.id} --probe` },
    adapter,
    { onExecution: (e) => console.log(`#${e.seq + 1} ${e.executedInput.income.toLocaleString("en-US").padStart(12)} ${e.result.padEnd(18)} ${e.reason.slice(0, 90)}`) },
  );
  const out = `evidence/live/${t.id}-${stamp}.json`;
  writeFileSync(out, JSON.stringify({ disclosure: "PRIVATE_FINDING", target: t.id, run }, null, 1));
  console.log(`\nVerdict: ${run.summary.verdict}. ${run.summary.verdictText}\nCounts: ${JSON.stringify(run.summary.counts)}\nWrote ${out}. This is a PRIVATE FINDING until a human decides otherwise (docs/responsible-testing.md).`);
}
await adapter.close();
