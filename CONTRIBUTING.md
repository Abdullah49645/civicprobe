# Contributing to CivicProbe

Thanks for your interest. CivicProbe's value rests on its results being trustworthy, so contributions
follow a few firm rules.

## Ground rules

1. **Never fabricate results.** Numbers in docs and the UI must come from `evidence/` or `docs/benchmark.json`.
2. **Keep fixtures and live targets separate.** Fixtures are labelled `DEMO_FIXTURE`; nothing in tests or CI may contact a live site.
3. **No model in the decision path.** Comparison, attribution, shrinking and diagnosis stay deterministic.
4. **Cautious language.** Report "candidate discrepancies against the encoded rule", never legal conclusions.

## Development workflow

```bash
npm ci
npx playwright install chromium
npm run verify        # typecheck + unit tests + benchmark gates + build
npm run test:e2e      # real-browser tests
```

If you change anything under `packages/`, `fixtures/` or `ui/`:

```bash
npm run evidence      # re-record scenarios (aborts if a replay digest differs)
npm run benchmark     # regenerate docs/benchmark.{json,md} if planning or mutants changed
npm run build         # regenerate dist/index.html (CI checks it is up to date)
```

## Adding a policy family or rule version

- Encode the rule as data in `fixtures/policies/` with full `provenance`. Add a verbatim excerpt to `fixtures/sources/` and record its sha256.
- Add cross-validation tests against independently published values.
- If the rule shape is new, the delta must stay **exact**. Add property tests comparing the computed region against brute-force evaluation.

## Pull requests

- Keep PRs focused; describe what changed and how you verified it.
- All CI checks must pass.
