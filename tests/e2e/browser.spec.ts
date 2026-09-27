import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRun } from "../../packages/pipeline/src/run.js";
import { FormAdapter } from "../../packages/service-adapters/src/form-adapter.js";
import { FIXTURE_RUNNER_CONFIG } from "../../packages/browser-runner/src/config.js";
import { SCENARIOS, inProcessAdapterFor, specFor, targetFor } from "../../fixtures/scenarios.js";
import { startFixture } from "../../fixtures/fixture-adapters.js";
import { createTaxServer, listen } from "../../fixtures/services/servers.js";

/**
 * Real Chromium, real local HTTP servers, the same FormAdapter class a live
 * target uses. The strongest check here: for every scenario, the run driven
 * through the browser produces EXACTLY the same result digest as calling the
 * fixture's implementation directly — i.e. the adapter layer (navigation,
 * form filling, parsing visible text) introduces no error.
 */
const clock = () => new Date("2026-09-26T00:00:00Z");

for (const s of SCENARIOS) {
  test(`browser ≡ in-process: ${s.id}`, async () => {
    const fx = await startFixture(s);
    try {
      const viaBrowser = await executeRun({ ...specFor(s, "playwright"), screenshots: false }, fx.adapter, { now: clock });
      const direct = await executeRun({ ...specFor(s, "in-process"), screenshots: false }, inProcessAdapterFor(s), { now: clock });
      assert.equal(viaBrowser.plan.id, direct.plan.id);
      assert.equal(viaBrowser.resultDigest, direct.resultDigest);
      assert.equal(viaBrowser.summary.counts.EXECUTION_FAILURE, 0);
      assert.equal(viaBrowser.environment.blockedRequests.length, 0);
    } finally {
      await fx.close();
    }
  });
}

test("identity: two independent browser runs (different ephemeral ports, different times) give the same runId and digest", async () => {
  const s = SCENARIOS.find((x) => x.id === "tax-legacy-surcharge")!;
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const fx = await startFixture(s);
    try {
      const r = await executeRun({ ...specFor(s, "playwright"), screenshots: false }, fx.adapter);
      ids.push(r.identity.runId + "|" + r.resultDigest);
    } finally {
      await fx.close();
    }
  }
  assert.equal(ids[0], ids[1]);
});

test("parser reads the ANNUAL figure from a sentence containing both annual and monthly amounts", async () => {
  const s = SCENARIOS.find((x) => x.id === "tax-correct")!;
  const fx = await startFixture(s);
  try {
    await fx.adapter.discover();
    const o = await fx.adapter.execute({ income: 3_650_000 });
    assert.equal(o.status, "ok");
    assert.equal(o.value, "428500");
    assert.match(o.rawText, /per month/);
  } finally {
    await fx.close();
  }
});

test("unit guard: if the result does not state the oracle's unit, the case is ASSUMPTION_MISMATCH, not compared", async () => {
  const s = SCENARIOS.find((x) => x.id === "tax-correct")!;
  const srv = await listen(createTaxServer("none"));
  const adapter = new FormAdapter({
    id: "t", version: "t", target: targetFor(s, srv.url + "/"), allowedOrigins: [new URL(srv.url).origin], runner: FIXTURE_RUNNER_CONFIG,
    versionSelect: { selector: "#year", optionPattern: "2026-27" }, fields: [{ name: "income", selector: "#income" }], submit: "#calc", result: "#result",
    parse: { kind: "number", pattern: "Rs\\.\\s*([0-9,]+)", unitGuard: "per annum" },
  });
  try {
    await adapter.discover();
    assert.equal((await adapter.execute({ income: 5_000_000 })).status, "assumption_mismatch");
  } finally {
    await adapter.close();
    await srv.close();
  }
});

test("read-only guard: navigation to a non-allowlisted origin is blocked and recorded", async () => {
  const s = SCENARIOS.find((x) => x.id === "tax-correct")!;
  const srv = await listen(createTaxServer("none"));
  const adapter = new FormAdapter({
    id: "t", version: "t", target: targetFor(s, srv.url + "/"), allowedOrigins: ["http://127.0.0.1:1"], runner: FIXTURE_RUNNER_CONFIG,
    fields: [{ name: "income", selector: "#income" }], submit: "#calc", result: "#result", parse: { kind: "number", pattern: "([0-9]+)" },
  });
  try {
    const o = await adapter.execute({ income: 1 });
    assert.notEqual(o.status, "ok");
    assert.equal(adapter.blockedRequests.length, 1);
  } finally {
    await adapter.close();
    await srv.close();
  }
});

test("rate cap: exceeding maxRequestsPerRun is EXECUTION_FAILURE (rate_capped), not a silent skip", async () => {
  const s = SCENARIOS.find((x) => x.id === "tax-correct")!;
  const srv = await listen(createTaxServer("none"));
  const adapter = new FormAdapter({
    id: "t", version: "t", target: targetFor(s, srv.url + "/"), allowedOrigins: [new URL(srv.url).origin], runner: { ...FIXTURE_RUNNER_CONFIG, maxRequestsPerRun: 1 },
    fields: [{ name: "income", selector: "#income" }], submit: "#calc", result: "#result", parse: { kind: "number", pattern: "annual income tax\\s*Rs\\.\\s*([0-9,]+)" },
  });
  try {
    assert.equal((await adapter.execute({ income: 1 })).status, "ok");
    assert.equal((await adapter.execute({ income: 2 })).status, "rate_capped");
  } finally {
    await adapter.close();
    await srv.close();
  }
});
