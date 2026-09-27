import { FormAdapter } from "../packages/service-adapters/src/form-adapter.js";
import { FIXTURE_RUNNER_CONFIG } from "../packages/browser-runner/src/config.js";
import { createTaxServer, createWaiverServer, listen } from "./services/servers.js";
import { targetFor, type Scenario } from "./scenarios.js";
import type { TaxFault, WaiverFault } from "./services/vendor-calculator.js";

/** Start the scenario's local fixture server and build the SAME FormAdapter a live target uses. */
export async function startFixture(s: Scenario): Promise<{ adapter: FormAdapter; url: string; close: () => Promise<void> }> {
  const srv = await listen(s.family === "tax" ? createTaxServer(s.fault as TaxFault, { offerTy2027: s.offerTy2027 }) : createWaiverServer(s.fault as WaiverFault));
  const origin = new URL(srv.url).origin;
  const adapter =
    s.family === "tax"
      ? new FormAdapter({
          id: "form-adapter:salary-calculator",
          version: "2.0.0",
          target: targetFor(s, srv.url + "/"),
          allowedOrigins: [origin],
          runner: FIXTURE_RUNNER_CONFIG,
          versionSelect: { selector: "#year", optionPattern: "2026-27" },
          fields: [{ name: "income", selector: "#income" }],
          submit: "#calc",
          result: "#result",
          parse: { kind: "number", pattern: "annual income tax\\s*Rs\\.\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)", unitGuard: "annual" },
        })
      : new FormAdapter({
          id: "form-adapter:eligibility-screener",
          version: "2.0.0",
          target: targetFor(s, srv.url + "/"),
          allowedOrigins: [origin],
          runner: FIXTURE_RUNNER_CONFIG,
          fields: [
            { name: "age", selector: "#age" },
            { name: "income", selector: "#hh" },
          ],
          submit: "#check",
          result: "#result",
          parse: { kind: "category", categories: ["Eligible", "Not eligible"] },
        });
  return {
    adapter,
    url: srv.url,
    close: async () => {
      await adapter.close();
      await srv.close();
    },
  };
}
