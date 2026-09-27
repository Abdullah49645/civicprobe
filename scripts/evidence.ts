/**
 * Runs every demo scenario through the REAL pipeline: local fixture server,
 * real Chromium via Playwright, the same FormAdapter a live target uses.
 * Writes evidence/runs/<scenario>.json and evidence/manifest.json. The UI is
 * built from these files and nothing else.
 *
 * Each browser run is then replayed in-process and its result digest must
 * match — a build-time reproducibility check. A mismatch aborts.
 *
 *   npm run evidence                     all scenarios
 *   npm run evidence -- --only tax-stale-rate
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { executeRun } from "../packages/pipeline/src/run.js";
import { BrowserRunner } from "../packages/browser-runner/src/runner.js";
import { SCENARIOS, inProcessAdapterFor, specFor } from "../fixtures/scenarios.js";
import { startFixture } from "../fixtures/fixture-adapters.js";

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const pw = JSON.parse(readFileSync("node_modules/playwright/package.json", "utf8")).version;
const chromium = await BrowserRunner.chromiumVersion();
const runnerLabel = `playwright ${pw} / chromium ${chromium} / node ${process.version}`;
mkdirSync("evidence/runs", { recursive: true });

const manifestPath = "evidence/manifest.json";
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { scenarios: {} };
for (const s of SCENARIOS.filter((x) => !only || x.id === only)) {
  process.stdout.write(`${s.id.padEnd(22)} `);
  const fx = await startFixture(s);
  let run;
  try {
    run = await executeRun(specFor(s, runnerLabel), fx.adapter);
  } finally {
    await fx.close();
  }
  const replay = await executeRun({ ...specFor(s, "in-process"), screenshots: false }, inProcessAdapterFor(s));
  if (replay.resultDigest !== run.resultDigest || replay.plan.id !== run.plan.id) {
    console.error(`\nREPRODUCIBILITY CHECK FAILED for ${s.id}: browser ${run.resultDigest} vs in-process ${replay.resultDigest}`);
    process.exit(1);
  }
  writeFileSync(`evidence/runs/${s.id}.json`, JSON.stringify({ scenario: s, run }));
  manifest.scenarios[s.id] = {
    runId: run.identity.runId,
    planId: run.plan.id,
    resultDigest: run.resultDigest,
    verdict: run.summary.verdict,
    counts: run.summary.counts,
    executions: run.executions.length,
    pageLoads: run.environment.pageLoads,
    durationMs: run.environment.durationMs,
    recordedAt: run.environment.finishedAt,
  };
  console.log(`${run.summary.verdict.padEnd(12)} planned ${run.summary.planned}, executed ${run.executions.length} (${run.environment.pageLoads} page loads, ${run.environment.durationMs} ms), digest ${run.resultDigest.slice(0, 12)} ✓ replay`);
}
manifest.runner = runnerLabel;
manifest.generatedBy = "scripts/evidence.ts";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
