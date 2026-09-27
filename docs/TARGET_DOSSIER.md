# Target dossier: Pakistan salaried income tax, TY2026 → TY2027

## 1. Oracle
- **Old (TY2026):** First Schedule, Part I, Division I (salaried), ITO 2001 as amended up to
  20.02.2026, plus the s.4AB 9% surcharge on salaried income above Rs. 10,000,000.
  Excerpt: `fixtures/sources/pk-salaried-table-ty2026.txt` (sha256 recorded in the policy file).
- **New (TY2027):** Finance Act 2026 substitution of the same table; the s.4AB surcharge is withdrawn for
  salaried persons. Excerpt: `fixtures/sources/pk-salaried-table-ty2027.txt`.
- **Status: CORROBORATED.** Both encodings reproduce all 9 worked values in KPMG Taseer Hadi & Co., *A
  Brief of Finance Act, 2026* (July 2026), e.g. 12,000,000 → 3,685,290 (old, incl. surcharge) vs
  3,174,000 (new). The old table also reproduces 5 PakFiler worked examples. Tests:
  `packages/policy-engine/src/pk-cross-validation.test.ts`, which also checks that each
  excerpt's hash and parsed table match the encoded rows.
- **Not LOCKED because** the enacted Act / FBR consolidated ordinance PDF has not been downloaded and
  hashed (no outbound network in the build sandbox). The enactment date differs across secondary sources
  (KPMG: 27 June 2026; others: gazetted 26 June 2026); CivicProbe does not rely on it.
- To lock: download the FBR consolidated ITO after the Finance Act 2026, record its sha256 in
  `provenance.authority.artifactSha256`, confirm the table, set status `LOCKED`.

## 2. Live targets: status
**No live target has been executed.** Configs are in `fixtures/live-targets.ts`, with UNVERIFIED selectors.

| Target | Why | First probes |
|---|---|---|
| PakFiler salary tax calculator | Monthly input + tax-year dropdown; exercises the annual→monthly lattice | 3,199,992; 4,099,992; 10,000,008 |
| LegalPK income tax calculator | **Lead:** page copy seen via search still describes a 9% surcharge above Rs. 10M for 2026-27 | 10,000,001; 12,000,000 |

A lead is a hypothesis about page text, **not** an observation of calculator behaviour.

## 3. Procedure (network-enabled machine)
1. `npm run live -- --target legalpk` (discover only). Read the output; fix selectors if needed.
2. Read the site's terms. `--priority` runs 3 probes; `--probe` runs the full plan (≤120 requests, 1.5 s apart).
3. Output goes to `evidence/live/` (git-ignored), marked `PRIVATE_FINDING`. Follow `docs/responsible-testing.md` before any disclosure.
