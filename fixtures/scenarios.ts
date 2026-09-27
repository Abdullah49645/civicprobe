/**
 * The demo scenarios, as data. Pure (no Node, no Playwright), so the same
 * definitions drive the Playwright evidence runs, the tests, and the
 * published UI's in-browser replay.
 */
import type { ComparisonConfig } from "../packages/shared/src/result.js";
import type { RunSpec } from "../packages/pipeline/src/run.js";
import type { TargetDescriptor } from "../packages/service-adapters/src/types.js";
import { InProcessAdapter } from "../packages/service-adapters/src/in-process-adapter.js";
import { PK_SALARY_TAX_NEW, PK_SALARY_TAX_OLD } from "./policies/pk-salary-tax.js";
import { FEE_WAIVER_NEW, FEE_WAIVER_OLD } from "./policies/fee-waiver.js";
import { TAX_FAULTS, vendorAnnualTax, vendorWaiver, WAIVER_FAULTS, type TaxFault, type WaiverFault } from "./services/vendor-calculator.js";

export const PK_COMPARISON: ComparisonConfig = { rounding: "half-up", absoluteTolerance: 1 };
export const PK_COMPARISON_JUSTIFICATION =
  "Calculators display whole rupees and the table does not prescribe a rounding convention. Both sides are rounded half-up to whole rupees and may differ by at most Rs. 1, which absorbs rounding-convention and floating-point differences but nothing larger.";

export interface Scenario {
  id: string;
  family: "tax" | "waiver";
  title: string;
  fault: string;
  faultTitle: string;
  faultDescription: string | null;
  offerTy2027?: boolean;
  hero?: boolean;
}

export const SCENARIOS: Scenario[] = [
  ...(["stale-rate", "none", "legacy-surcharge", "missing-band", "ignores-year", "branch-typo"] as TaxFault[]).map((f) => ({
    id: `tax-${f === "none" ? "correct" : f}`,
    family: "tax" as const,
    title: "PK salaried tax, TY2026 → TY2027",
    fault: f,
    faultTitle: TAX_FAULTS[f].title,
    faultDescription: f === "none" ? null : TAX_FAULTS[f].description,
    hero: f === "stale-rate",
  })),
  { id: "tax-not-updated", family: "tax", title: "PK salaried tax, TY2026 → TY2027", fault: "none", faultTitle: "Tax year 2026-27 not offered", faultDescription: "The calculator's tax-year dropdown stops at 2025-26.", offerTy2027: false },
  ...(["stale-age", "none"] as WaiverFault[]).map((f) => ({
    id: `waiver-${f === "none" ? "correct" : f}`,
    family: "waiver" as const,
    title: "Senior fee waiver v1 → v2 (invented)",
    fault: f,
    faultTitle: WAIVER_FAULTS[f].title,
    faultDescription: f === "none" ? null : WAIVER_FAULTS[f].description,
  })),
];

export function targetFor(s: Scenario, url: string): TargetDescriptor {
  return { id: `fixture:${s.id}`, label: s.family === "tax" ? "Fixture salary tax calculator" : "Fixture fee-waiver screener", nature: "DEMO_FIXTURE", url, seededFault: s.faultDescription };
}

export function specFor(s: Scenario, runnerLabel: string): RunSpec {
  const replayCommand = `npm run evidence -- --only ${s.id}`;
  if (s.family === "tax") {
    return {
      family: "progressive-schedule",
      oldPolicy: PK_SALARY_TAX_OLD,
      newPolicy: PK_SALARY_TAX_NEW,
      comparison: PK_COMPARISON,
      comparisonJustification: PK_COMPARISON_JUSTIFICATION,
      plan: { ceiling: 12_000_000, randomFill: 8, controls: true, seed: 2026, tolerance: PK_COMPARISON.absoluteTolerance },
      shrink: true,
      screenshots: true,
      runnerLabel,
      replayCommand,
    };
  }
  return { family: "eligibility-rule", oldPolicy: FEE_WAIVER_OLD, newPolicy: FEE_WAIVER_NEW, comparisonJustification: "Categorical outcome; compared case- and whitespace-insensitively.", shrink: true, screenshots: true, runnerLabel, replayCommand };
}

/** The fixture's implementation called directly, as the browser run would observe it. */
export function inProcessAdapterFor(s: Scenario, url = "in-process"): InProcessAdapter {
  const target = targetFor(s, url);
  if (s.family === "tax") {
    return new InProcessAdapter(target, (i) => String(vendorAnnualTax(i.income, "2026-27", s.fault as TaxFault)), { income: { step: 1 } }, s.offerTy2027 ?? true);
  }
  return new InProcessAdapter(target, (i) => vendorWaiver(i.age, i.income, s.fault as WaiverFault), { age: { step: 1 }, income: { step: 1 } });
}
