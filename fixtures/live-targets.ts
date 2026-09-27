/**
 * Candidate LIVE targets. Every selector below is UNVERIFIED until
 * `npm run live -- --target <id>` (discover-only) has been run from a
 * network-enabled machine and a human has read its output. See
 * docs/TARGET_DOSSIER.md §2–§3. Nothing here is executed by tests or CI.
 */
import { LIVE_RUNNER_CONFIG } from "../packages/browser-runner/src/config.js";
import type { FormAdapterConfig } from "../packages/service-adapters/src/form-adapter.js";

export interface LiveTarget {
  id: string;
  config: FormAdapterConfig;
  /** Why this target, and what to probe first. */
  notes: string;
  /** Inputs to execute first (annual PKR), before the full plan. */
  priorityProbes: number[];
}

export const LIVE_TARGETS: LiveTarget[] = [
  {
    id: "pakfiler",
    notes: "Public salary-tax calculator taking MONTHLY salary with a tax-year dropdown (page text reviewed 2026-09-21). Monthly input means only multiples of 12 are reachable; the pipeline projects each probe and records both.",
    priorityProbes: [3_199_992, 4_099_992, 10_000_008, 12_000_000],
    config: {
      id: "form-adapter:salary-calculator",
      version: "2.0.0",
      target: { id: "live:pakfiler", label: "PakFiler salary tax calculator", nature: "LIVE_TARGET", url: "https://pakfiler.com/services/salary-tax-calculator", seededFault: null },
      allowedOrigins: ["https://pakfiler.com"],
      runner: LIVE_RUNNER_CONFIG,
      versionSelect: { selector: "select", optionPattern: "2026\\s*-\\s*(20)?27" },
      fields: [{ name: "income", selector: "input[type=number]", transform: "annual-to-monthly" }],
      submit: "button:has-text('Calculate')",
      result: "text=/annual tax/i >> xpath=..",
      parse: { kind: "number", pattern: "annual tax[^0-9]*([0-9][0-9,]*(?:\\.[0-9]+)?)", unitGuard: "annual" },
    },
  },
  {
    id: "legalpk",
    notes: "Page copy (seen via search, 2026-09-26) says a 9% surcharge applies above Rs. 10,000,000 for 2026-27, which the Finance Act 2026 withdrew for salaried persons. That is a HYPOTHESIS about the calculator's behaviour, not an observation. Probe 10,000,001 and 12,000,000 first.",
    priorityProbes: [10_000_001, 12_000_000, 9_999_999],
    config: {
      id: "form-adapter:salary-calculator",
      version: "2.0.0",
      target: { id: "live:legalpk", label: "LegalPK salary tax calculator", nature: "LIVE_TARGET", url: "https://legalpk.com/income-tax-calculator", seededFault: null },
      allowedOrigins: ["https://legalpk.com"],
      runner: LIVE_RUNNER_CONFIG,
      fields: [{ name: "income", selector: "input[type=number]" }],
      submit: "button[type=submit]",
      result: "[class*=result]",
      parse: { kind: "number", pattern: "annual[^0-9]*tax[^0-9]*([0-9][0-9,]*(?:\\.[0-9]+)?)", unitGuard: "annual" },
    },
  },
];
