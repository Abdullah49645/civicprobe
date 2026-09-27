# Changelog

## 2.0.0 (rebuild)
- Exact rational delta engine (cells, statute-level edits); fixes v1 breakpoint and endpoint bugs.
- Deterministic delta-directed planner with rationales and observability probes.
- Certified shrinker (anchors → bisection → exhaustive window); coordinate shrinking for 2-D rules.
- Diagnosis: single-fault hypotheses kept only if they reproduce every observation.
- Six result states; execution failures never become discrepancies.
- Content-addressed run identity and result digests; browser ≡ in-process check at build time.
- Independent fixture calculators (9 scenarios, incl. NOT_UPDATED and a 2-field eligibility rule).
- Mutation-analysis benchmark (60 generated mutants, computed ground truth, 300 random seeds).
- Static single-file viewer with bundled engine and in-browser replay; accessibility pass.
- Taxpayer check (English/Urdu) at the top of the site: correct 2026-27 tax, slab explanation, old-law detection, note for the calculator's owner.
- "In plain words" summaries on every technical section; viewer e2e test suite.
- Live check in the viewer: reviewers test any real calculator by hand; the in-page engine compares and diagnoses.
- Live runner: read-only guard, rate cap, robots.txt, discover-only default.
- Oracle cross-validated against KPMG (Finance Act 2026) for both versions.

## 1.x
Prototype. Superseded; see git history.
