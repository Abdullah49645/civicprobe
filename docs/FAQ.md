# FAQ

**Isn't this just property-based testing?** The parts exist: PBT, boundary analysis, mutation testing,
policy-as-code. What is new is using the *difference between two versions of a rule* as the search space,
with an exact affected region, observability-aware probes, certified shrinking and diagnosis.

**Why not test random incomes?** On 47 generated faults, random finds 36.7% within 50 probes;
CivicProbe finds 100%. Random is weakest on narrow faults and gets worse as the domain grows.

**A 2-rupee counterexample?** It is the *smallest* failing input. The same fault reaches Rs. 45,000 at
4,099,999. Minimality is what makes the case checkable by hand.

**Does an AI decide results?** No. Comparison, attribution and diagnosis are deterministic, and every
decision can be recomputed from the evidence (or in the page, via Replay).

**Did you find a real bug in a real site?** Not yet. See [TARGET_DOSSIER.md](TARGET_DOSSIER.md) for the leads and the procedure.
