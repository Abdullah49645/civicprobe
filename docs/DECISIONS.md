# Design decisions

1. **Exact rational arithmetic everywhere in the oracle and delta.** Floats made "is the tax different
   here?" a tolerance question. With BigInt rationals, the affected region is proved, not estimated.
2. **Cell decomposition for the delta.** Singleton cells at every breakpoint of either version, open cells
   between them. On each open cell NEW−OLD is affine, so "differs anywhere / everywhere / at one
   point" is exact. This fixed v1 bugs: wrong piece at breakpoints, closed endpoints where the statute
   says "exceeds", and crossings reported as differing everywhere.
3. **Statute-level edits (components).** Rate, base, threshold introduced/removed, surcharge changes, each
   with an id. The UI's redline and the diagnosis are both built on them.
4. **Observability probes.** The fixture's branch-typo fault was missed at first: a misplaced threshold is
   invisible at T±1 after rounding. The planner now places probes at k = ⌊(τ+1)/Δslope⌋+1 on each side,
   derived from the table and the comparison tolerance. The benchmark then tests typos at every threshold,
   in 3 widths and both directions, not just the one that exposed the gap.
5. **Certified shrinking.** Bisection assumes monotone failure; rounding breaks that (recorded evidence:
   3,200,025 fails, 3,200,029 conforms). Anchors → bisection → exhaustive window, with a certificate
   saying what was proved.
6. **Diagnosis by falsification.** Hypotheses come from the delta. One survives only if it reproduces every
   observation. No scoring and no model.
7. **One adapter class for fixtures and live targets.** The fixture path cannot be easier than production.
8. **Content-addressed identity.** A fixture's ephemeral port is excluded from identity (it was a bug:
   run ids changed between runs); a live URL is included.
9. **Independent fixtures.** Fixture calculators are if/else float code, not the oracle. A fixture that
   reuses the oracle cannot disagree with it.
10. **Static single-file viewer with the engine bundled.** Judges can verify, not just watch: replay
    recomputes everything in the page.
