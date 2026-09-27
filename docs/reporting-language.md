# Reporting language

Per build-prompt §22. This is the one page to check before writing any
public-facing sentence about a CivicProbe result — in the UI, a README, a
demo script, or a conversation with a judge.

## The rule

CivicProbe never asserts a legal violation. It never says a government or a
service is "breaking the law," "non-compliant," "illegal," or similar. It
reports a **candidate policy/service discrepancy** against an **explicit,
source-linked, versioned oracle** — nothing more, nothing less.

## Approved phrasing

- "Candidate policy/service discrepancy: observed service behavior differs
  from the configured policy oracle."
- "Observed service behavior conforms to the configured policy oracle
  within the stated tolerance."
- "Evidence is insufficient to determine conformance for this case."

These three sentences (plus the `ASSUMPTION_MISMATCH`/`NOT_UPDATED`/
`EXECUTION_FAILURE` variants) are implemented as the single source of truth
in `packages/evidence/src/run.ts`'s `reportingLanguage()` function — every
surface (CLI output, the UI's evidence drawer, any future report generator)
should call that function rather than writing its own phrasing, so the
wording can't drift out of policy in one place while staying correct in
another.

## Why this matters here specifically

CivicProbe's whole premise is testing government software with a
computational oracle. That oracle is deliberately narrow (see the Oracle
Principle in `TARGET_DOSSIER.md`'s structure) — it encodes one specific,
sourced policy delta, not an entire legal regime, and it can be wrong in
ways a human reviewer needs to be able to catch (see `LIMITATIONS.md`'s
false-positive/false-negative sections). Calling a result a "violation"
would claim a legal judgment the software is not equipped to make and was
never asked to make. Calling it a "candidate discrepancy" is accurate to
what was actually computed: two numbers disagreed, under stated
assumptions, within a stated tolerance.

## Disclosure state is separate from reporting language

A `DISCREPANCY` result is not automatically a public claim about anything.
Every discrepancy starts as a `PRIVATE_FINDING`
(the `PRIVATE_FINDING` marker written by `scripts/live.ts`).
Moving it to `PUBLIC_REPRODUCIBLE_FINDING` is a human decision — see
`docs/responsible-testing.md`'s "Disclosure" section — never something the
software does on its own.
