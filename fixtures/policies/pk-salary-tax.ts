/**
 * Pakistan — tax on salaried individuals, First Schedule Part I Division I.
 * OLD: Tax Year 2026 (Finance Act 2025).  NEW: Tax Year 2027 (Finance Act 2026).
 *
 * This is the canonical real-world oracle. It encodes ONE provision (the
 * salaried rate table + the s.4AB surcharge as it applies to salaried
 * persons) and nothing else. Every number here is linked to:
 *   - a committed verbatim excerpt (fixtures/sources/*.txt, hash below), which
 *     a unit test parses and compares row-by-row against these rows;
 *   - independent worked examples (pk-salary-tax-cross-validation.test.ts).
 * Provenance status is CORROBORATED, not LOCKED: the enacted artifact's
 * bytes have not been hashed from a network-enabled machine yet
 * (docs/TARGET_DOSSIER.md §1).
 */
import type { ProgressiveSchedule, SourceReference } from "../../packages/policy-engine/src/types.js";

const KPMG_FA2026: SourceReference = {
  id: "kpmg-brief-finance-act-2026",
  kind: "professional-analysis",
  title: "A Brief of Finance Act, 2026",
  publisher: "KPMG Taseer Hadi & Co.",
  url: "https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/07/A%20Brief%20of%20Finance%20Act%202026.pdf.coredownload.inline.pdf",
  retrievedAt: "2026-09-26",
  locator: "First Schedule, Division I changes table + impact analysis (p. 15); Tax Rate Card (pp. 23–24); s.4AB note",
  note: "Post-enactment review. States the salaried table as enacted (identical to the Bill), withdrawal of the s.4AB surcharge for salaried persons, and nine OLD/NEW worked values used in cross-validation.",
};

const COMMON_ASSUMPTIONS = [
  "Applies to an individual whose income under the head \"Salary\" exceeds 75% of taxable income (the salaried table). The separate non-salaried/AOP table is out of scope.",
  "Input is ANNUAL TAXABLE income in whole PKR, after any exemptions/deductions. CivicProbe does not model allowances, zakat, or deductions.",
  "Output is annual income tax before tax credits and withholding adjustments.",
  "Super tax (s.4C) is not modelled; its thresholds (≥ Rs. 150 million) lie outside the probed domain.",
];

export const PK_SALARY_TAX_OLD: ProgressiveSchedule = {
  kind: "progressive-schedule",
  id: "pk-salaried-ty2026",
  title: "Salaried individuals — Tax Year 2026",
  jurisdiction: "Pakistan (federal)",
  input: { name: "income", label: "Annual taxable income", unit: "PKR", min: 0 },
  output: { name: "tax", label: "Annual income tax", unit: "PKR" },
  effective: { from: "2025-07-01", to: "2026-06-30", label: "TY2026" },
  rows: [
    { row: "S. No. 1", over: 0, upTo: 600_000, base: 0, rate: "0" },
    { row: "S. No. 2", over: 600_000, upTo: 1_200_000, base: 0, rate: "0.01" },
    { row: "S. No. 3", over: 1_200_000, upTo: 2_200_000, base: 6_000, rate: "0.11" },
    { row: "S. No. 4", over: 2_200_000, upTo: 3_200_000, base: 116_000, rate: "0.23" },
    { row: "S. No. 5", over: 3_200_000, upTo: 4_100_000, base: 346_000, rate: "0.30" },
    { row: "S. No. 6", over: 4_100_000, upTo: null, base: 616_000, rate: "0.35" },
  ],
  surcharge: { row: "s.4AB", over: 10_000_000, rateOnTax: "0.09" },
  assumptions: [...COMMON_ASSUMPTIONS, "Includes the s.4AB surcharge (9% of tax where taxable income exceeds Rs. 10,000,000) as it applied to salaried persons in TY2026."],
  provenance: {
    status: "CORROBORATED",
    statusReason:
      "Transcribed from KPMG's post-enactment 'existing rate' column; all rows internally continuous; matches 5 independent PakFiler worked examples and 9 KPMG worked values (including the surcharge case at Rs. 12,000,000). The FBR consolidated Ordinance is identified but its bytes are not yet hashed.",
    authority: {
      id: "fbr-ito-2001-consolidated-2026-02-20",
      kind: "consolidated-statute",
      title: "Income Tax Ordinance, 2001 (amended up to 20.02.2026)",
      publisher: "Federal Board of Revenue",
      url: "https://download1.fbr.gov.pk/Docs/2026226162211364IncomeTaxOrdinance2001-Amended-20.02.2026.pdf",
      retrievedAt: "2026-09-26",
      locator: "First Schedule, Part I, Division I (salaried table); s.4AB",
      note: "Identified via search; the table was not extracted from this artifact in this session. Hash pending.",
      excerpt: { path: "fixtures/sources/pk-salaried-table-ty2026.txt", sha256: "c15747dd8538b070ebfc9e15266c018c5b64c147819b77649b7484340781b6dd" },
    },
    corroboration: [
      KPMG_FA2026,
      {
        id: "pakfiler-worked-examples",
        kind: "secondary-publication",
        title: "PakFiler salary tax calculator — published TY2025-26 worked examples",
        publisher: "PakFiler",
        url: "https://pakfiler.com/services/salary-tax-calculator",
        retrievedAt: "2026-09-21",
        note: "Five monthly-salary → annual-tax examples, used in cross-validation. Page text, not calculator output.",
      },
    ],
  },
};

export const PK_SALARY_TAX_NEW: ProgressiveSchedule = {
  kind: "progressive-schedule",
  id: "pk-salaried-ty2027",
  title: "Salaried individuals — Tax Year 2027",
  jurisdiction: "Pakistan (federal)",
  input: { name: "income", label: "Annual taxable income", unit: "PKR", min: 0 },
  output: { name: "tax", label: "Annual income tax", unit: "PKR" },
  effective: { from: "2026-07-01", label: "TY2027" },
  rows: [
    { row: "S. No. 1", over: 0, upTo: 600_000, base: 0, rate: "0" },
    { row: "S. No. 2", over: 600_000, upTo: 1_200_000, base: 0, rate: "0.01" },
    { row: "S. No. 3", over: 1_200_000, upTo: 2_200_000, base: 6_000, rate: "0.11" },
    { row: "S. No. 4", over: 2_200_000, upTo: 3_200_000, base: 116_000, rate: "0.20" },
    { row: "S. No. 5", over: 3_200_000, upTo: 4_100_000, base: 316_000, rate: "0.25" },
    { row: "S. No. 6", over: 4_100_000, upTo: 5_600_000, base: 541_000, rate: "0.29" },
    { row: "S. No. 7", over: 5_600_000, upTo: 7_000_000, base: 976_000, rate: "0.32" },
    { row: "S. No. 8", over: 7_000_000, upTo: null, base: 1_424_000, rate: "0.35" },
  ],
  assumptions: [...COMMON_ASSUMPTIONS, "No s.4AB surcharge: withdrawn for salaried persons by the Finance Act, 2026."],
  provenance: {
    status: "CORROBORATED",
    statusReason:
      "Table encoded from the Finance Bill 2026 text and confirmed unchanged as enacted by KPMG's post-enactment brief; all rows internally continuous; matches 9 KPMG worked values. Enacted-Act artifact bytes not yet hashed.",
    authority: {
      id: "pk-finance-bill-2026",
      kind: "bill",
      title: "Finance Bill, 2026",
      publisher: "Ministry of Finance, Government of Pakistan",
      url: "https://www.finance.gov.pk/tpo_updates/Finance_Bill_2026.pdf",
      retrievedAt: "2026-09-21",
      locator: "Amendment substituting the First Schedule, Part I, Division I salaried table; amendment to s.4AB for salaried persons",
      note: "A Bill is not the Act. Enactment without change to this table is established by the corroborating post-enactment source.",
      excerpt: { path: "fixtures/sources/pk-salaried-table-ty2027.txt", sha256: "5e4875c10bec8d24579fb13d0fa223484a5705d33e3ee8d42c769fe1d32a9ee7" },
    },
    corroboration: [
      KPMG_FA2026,
      {
        id: "mercans-fa2026-payroll",
        kind: "secondary-publication",
        title: "Pakistan Finance Act 2026-27 Payroll Updates",
        publisher: "Mercans",
        url: "https://mercans.com/resources/statutory-alerts/pakistan-finance-act-2026-27-1-july-2026/",
        retrievedAt: "2026-09-26",
        note: "Reports passage, assent and gazette publication, and abolition of the 9% salaried surcharge. Reported dates differ between secondary sources (see TARGET_DOSSIER.md).",
      },
    ],
  },
};
