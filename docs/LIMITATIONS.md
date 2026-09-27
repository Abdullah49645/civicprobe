# Limitations

- Exact delta covers two rule families: progressive schedules (with a surcharge) and eligibility rules
  over integer fields. Other rule shapes are out of scope.
- The oracle is an encoding. Its status is CORROBORATED, not LOCKED (see [TARGET_DOSSIER.md](TARGET_DOSSIER.md) §1). A
  discrepancy means "differs from this encoding under this comparison rule".
- All recorded services are local demo fixtures with seeded faults. No live service has been tested.
- CivicProbe targets policy-update faults. Regressions at unchanged thresholds are out of scope (the
  benchmark shows 0% detection for those).
- Diagnosis considers single-fault hypotheses only. Multiple simultaneous faults show as "no single
  hypothesis survives".
- The live adapter parses visible text with a configured pattern. Pages that render results as images or
  canvas, or behind login or CAPTCHA, are not supported, by design.
- Conformance on the planned inputs is evidence, not proof, for all inputs.
