/**
 * An INDEPENDENT implementation of a salaried-tax calculator, written the way
 * a public calculator website typically is: an if/else ladder of hard-coded
 * constants, IEEE floats, and Math.round for display. It deliberately does
 * NOT import CivicProbe's policy engine — a fixture that reuses the oracle's
 * own code cannot meaningfully disagree with it.
 *
 * `fault` selects an INTENTIONALLY SEEDED defect. Each models a realistic
 * partial update of a real deployment. This module is shared by the local
 * HTTP fixture (driven by Playwright) and the published UI's in-browser
 * replay, so both observe the same implementation.
 */
export type TaxFault = "none" | "stale-rate" | "legacy-surcharge" | "missing-band" | "ignores-year" | "branch-typo";

export const TAX_FAULTS: Record<TaxFault, { title: string; description: string }> = {
  none: { title: "Correct implementation", description: "Implements the TY2027 salaried table correctly." },
  "stale-rate": {
    title: "Stale marginal rate (S. No. 5)",
    description: "The TY2027 fixed amounts were copied in, but the S. No. 5 marginal rate was left at the old 30% instead of 25%.",
  },
  "legacy-surcharge": {
    title: "Legacy surcharge branch",
    description: "The TY2027 table is correct, but a leftover branch still adds the withdrawn 9% surcharge above Rs. 10,000,000.",
  },
  "missing-band": {
    title: "Missing new band (S. No. 8)",
    description: "The Rs. 7,000,000 threshold was never added: income above Rs. 5,600,000 keeps the 32% rate forever.",
  },
  "ignores-year": {
    title: "Ignores the tax-year selector",
    description: "The page offers 2026-27, but the calculation always uses the TY2026 table and surcharge.",
  },
  "branch-typo": {
    title: "Typo in a branch condition",
    description: "The S. No. 6 branch is written as `income <= 4101000` instead of `<= 4100000`: a 1,000-rupee band uses the wrong row.",
  },
};

function ty2026(x: number): number {
  let t: number;
  if (x <= 600000) t = 0;
  else if (x <= 1200000) t = (x - 600000) * 0.01;
  else if (x <= 2200000) t = 6000 + (x - 1200000) * 0.11;
  else if (x <= 3200000) t = 116000 + (x - 2200000) * 0.23;
  else if (x <= 4100000) t = 346000 + (x - 3200000) * 0.3;
  else t = 616000 + (x - 4100000) * 0.35;
  if (x > 10000000) t = t * 1.09;
  return t;
}

function ty2027(x: number, fault: TaxFault): number {
  let t: number;
  const s5Rate = fault === "stale-rate" ? 0.3 : 0.25;
  const s5Upper = fault === "branch-typo" ? 4101000 : 4100000;
  if (x <= 600000) t = 0;
  else if (x <= 1200000) t = (x - 600000) * 0.01;
  else if (x <= 2200000) t = 6000 + (x - 1200000) * 0.11;
  else if (x <= 3200000) t = 116000 + (x - 2200000) * 0.2;
  else if (x <= s5Upper) t = 316000 + (x - 3200000) * s5Rate;
  else if (x <= 5600000) t = 541000 + (x - 4100000) * 0.29;
  else if (fault === "missing-band" || x <= 7000000) t = 976000 + (x - 5600000) * 0.32;
  else t = 1424000 + (x - 7000000) * 0.35;
  if (fault === "legacy-surcharge" && x > 10000000) t = t * 1.09;
  return t;
}

/** What the page displays: whole rupees. */
export function vendorAnnualTax(income: number, taxYear: "2025-26" | "2026-27", fault: TaxFault): number {
  const useOld = taxYear === "2025-26" || fault === "ignores-year";
  return Math.round(useOld ? ty2026(income) : ty2027(income, fault));
}

// --- Eligibility screener (DEMO FIXTURE ONLY, invented policy) ---

export type WaiverFault = "none" | "stale-age";

export const WAIVER_FAULTS: Record<WaiverFault, { title: string; description: string }> = {
  none: { title: "Correct implementation", description: "Implements the v2 rule (age ≥ 60, income ≤ 1,500,000)." },
  "stale-age": { title: "Stale age threshold", description: "The income cap was raised to 1,500,000, but the age check still says 65." },
};

export function vendorWaiver(age: number, income: number, fault: WaiverFault): "Eligible" | "Not eligible" {
  const minAge = fault === "stale-age" ? 65 : 60;
  return age >= minAge && income <= 1500000 ? "Eligible" : "Not eligible";
}
