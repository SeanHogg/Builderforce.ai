# Marketing claims review process

The code-owned registries in `frontend/src/lib/content.ts` are the source of truth for public capability, integration, workflow-proof, and high-risk marketing claims.

## Release gate

Before public copy ships:

1. Use an existing claim ID or add a scoped claim with an owner, status, data boundary, repository evidence, review date, and compliance-review requirement.
2. Describe only `available` or `beta` capabilities as current. `planned` work belongs in `ROADMAP.md`.
3. For privacy, security, deployment, audit, cost, pricing, regulated-industry, or competitive claims, state the tested boundary and obtain the indicated compliance review.
4. Add or update all five locale catalogs in the same change. Locale-parity tests are release-blocking.
5. Generate pricing and entitlement availability from the public API pricing contract; do not duplicate values in marketing components or structured data.
6. Comparison content must be criteria-first. Any vendor-specific fact needs a primary source, observation date, reviewer, and a review deadline no later than 30 days after observation.

## Freshness

- High-risk first-party claims expire on `reviewBy`; CI fails after that date.
- Capability and integration verification dates are reviewed at least quarterly.
- Competitor pricing and packaging are not stored as evergreen cells. Link readers to current vendor information and date any observed fact.
- Evidence failures, removed files, catalog-key drift, or a planned capability exposed as current fail automated tests.

## Review responsibility

- The named product owner verifies behavior and evidence.
- Security or legal reviews records marked `complianceReview: required`.
- Marketing owns approved wording and localization.
- Revenue owns conversion measurement, but may not broaden a claim beyond its registry scope.

## Incident correction

When a public claim is found inaccurate, scope or remove it immediately, update every locale and indexed article, record the product gap in `ROADMAP.md`, and add a regression assertion to the claim contract tests.
