# Responsible testing policy

CivicProbe tests public government software. This document is the
commitment that makes that acceptable to do.

## What CivicProbe will do

- Read-only interactions only: fill in synthetic values, read a computed
  result. Never submit a form that creates a binding record, application,
  or account.
- Only synthetic, non-personal input data — no real names, national ID
  numbers, addresses, or other PII, ever.
- Rate-limited, capped requests (`packages/browser-runner/src/config.ts`):
  a configurable minimum delay between requests and a hard cap on requests
  per run, enforced regardless of which adapter is running.
- Full trace and evidence preservation for every request made, so a target
  service operator (or Abdullah) can see exactly what CivicProbe did.
- Targets are only tested after a human reviews `ServiceAdapter.discover()`
  output — automated discovery informs a human decision, it doesn't
  authorize testing by itself.

## What CivicProbe will never do

- Bypass CAPTCHA, authentication, or any other access control. If a target
  needs either for the relevant flow, it is dropped as a candidate, not
  worked around.
- Submit a real, binding application or transaction.
- Create real accounts unnecessarily.
- Attempt any destructive action.
- Generate traffic beyond the configured rate limit, or beyond what a
  reasonable single researcher's manual testing would produce.
- Ignore a documented robots directive or Terms of Service on a candidate
  target. If a target's ToS prohibits automated access, it is dropped.

## Disclosure

A discovered discrepancy starts as a `PRIVATE_FINDING`
(`packages/evidence/src/run.ts`). CivicProbe does not automatically
publish or publicly attribute a discrepancy to a named service. Per
build-prompt §24, where appropriate, the affected service should get an
opportunity to respond before any public attribution — this is a human
decision, not something the software automates.

## Public reporting language

See `packages/evidence/src/run.ts`'s
`reportingLanguage()`: CivicProbe never asserts a legal violation. Output is
always framed as "candidate policy/service discrepancy" or "observed service
behavior differs from the configured policy oracle" — never "the government
is breaking the law."
