# Marketing claims review process

The code-owned registries are the source of truth for public capability, integration, workflow-proof, and high-risk marketing claims:

- `frontend/src/lib/content/product.ts` — capability proof, the integration matrix, workflow proof, and `MARKETING_CLAIMS` (the Claim-to-Proof register).
- `frontend/src/lib/content/compare.ts` — the comparison arenas and vendor leaf registry, and `COMPARE_VENDOR_FACT_SOURCES` (the sourced vendor facts; empty while comparison copy states none).

## Release gate

Before public copy ships:

1. Use an existing claim ID or add a scoped claim with an owner, status, data boundary, repository evidence, review date, and compliance-review requirement.
2. Describe only `available` or `beta` capabilities as current. `planned` work belongs in `ROADMAP.md`.
3. For privacy, security, deployment, audit, cost, pricing, regulated-industry, or competitive claims, state the tested boundary and obtain the indicated compliance review.
4. Add or update all five locale catalogs in the same change.
5. Generate pricing and entitlement availability from the public API pricing contract; do not duplicate values in marketing components or structured data.
6. Comparison content must be criteria-first. Any vendor-specific fact needs a primary source, observation date, reviewer, and a review deadline no later than 30 days after observation.
7. Avoid absolutes (every, always, never, zero, entire, guarantee/guarantees/guaranteed, unlimited, 100%) in public copy unless the register backs them; scope the sentence to what is true.

## What is enforced, and where

Release workflow job `Verify frontend`, which gates the deploy:

| Check (matrix entry) | Enforces |
| --- | --- |
| `marketing claims` — `capabilityProof.test.ts`, `blogLocale.test.ts`, `messages.test.ts`, `localizePack.test.ts` | Every capability, integration, workflow-proof and `MARKETING_CLAIMS` record declares boundaries, prerequisites and an ISO date; its evidence paths exist in the repository and are not URLs; a `planned` capability is not exposed as current; each `MARKETING_CLAIMS.reviewBy` is still in the future (CI fails after that date). `blogLocale.test.ts` covers blog catalog and translated-body localization. `src/i18n/messages.test.ts` asserts locale parity of the five catalogs, and `src/lib/templates/localizePack.test.ts` covers template-pack localization. |
| `guards + brain-ui + knowledge-graph-view` — runs `pnpm run check` | `check:public-copy-absolutes` (rule 7) and `check:compare-vendor-facts` (rule 6), below. The same manifest also runs `check:i18n-keys` (every key a component asks for exists in `en.json`), the methodology mirror and the other frontend guards. |

`pnpm run check` also runs locally as part of `npm test`.

- **`check:public-copy-absolutes`** (`frontend/scripts/check-public-copy-absolutes.mjs`) is a ratchet over `en.json` for the public marketing namespaces listed in the script. It matches exactly: every, always, never, zero, entire, guarantee, guarantees, guaranteed, unlimited, and 100% (also written `100 %`). A new absolute in those namespaces fails; each baseline entry records the matched words (`{ "words": [...], "why": "..." }`) and fails if the sentence now matches a different set of words; a baseline entry that no longer matches fails; and `public-copy-absolutes.baseline.json` can only shrink. A public route (the roots listed in the script) that reads a catalog namespace missing from `PUBLIC_NAMESPACES` (and from the explicit no-claim-copy list) also fails, so the scanned list cannot fall behind the routes. Entries whose `why` starts `claim-review-pending` are known-unreviewed claims that still need a rewrite or a justification; they are debt, not approval. There are currently none.
- **`check:compare-vendor-facts`** (`frontend/scripts/check-compare-vendor-facts.mjs`) scans every `compare.competitors.<vendor>.*` leaf string and every vendor cell in `compare.arenas.*` (not the Builderforce column) in all five locales for a price, currency amount, percentage, user count, or version number. Any hit fails unless `COMPARE_VENDOR_FACT_SOURCES` holds a record for that key with a source URL, an observed date, a reviewer, and a `reviewBy` at most 30 days after the observation; an expired `reviewBy` fails.

## Not automated

These are review steps, not CI checks:

- Compliance review of records marked `complianceReview: required`.
- Whether a claim's wording is accurate beyond the patterns above (the absolutes check catches the words, not the meaning).
- Locale parity of the five catalogs (rule 4) is asserted by `frontend/src/i18n/messages.test.ts` in the frontend vitest suite, which the `marketing claims` release entry runs (`pnpm run check` does not). The absolutes and vendor-fact checks read `en.json` (absolutes) and all five locales (vendor facts); whether a rewrite was carried into every locale is a review step. The quality of a translation is a marketing review.
- Capability and integration `lastVerified` dates are reviewed at least quarterly by the owner; CI checks that the date is valid, not that it is recent.

## Freshness

- High-risk first-party claims expire on `reviewBy`; CI fails after that date.
- Competitor pricing and packaging are not stored as evergreen cells. Link readers to current vendor information and date any observed fact.

## Review responsibility

- The named product owner verifies behavior and evidence.
- Security or legal reviews records marked `complianceReview: required`.
- Marketing owns approved wording and localization.
- Revenue owns conversion measurement, but may not broaden a claim beyond its registry scope.

## Incident correction

When a public claim is found inaccurate, scope or remove it immediately, update every locale and indexed article, record the product gap in `ROADMAP.md`, and add a regression assertion to the claim contract tests.
