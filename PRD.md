> **PRD** — drafted by Product Manager · task #534
> _Each agent that updates this PRD signs its change below._

# Trust & Discovery — Portfolios, Search, Verification & Tax Compliance (P2)

## Problem & Goal
Freelancers lack credible signals and discoverability tools, while clients struggle to evaluate talent and navigate compliant hiring. This Epic establishes core trust mechanisms (verification, portfolios, taxonomy) and discovery features (advanced search, promoted listings) plus foundational tax/employment compliance to reduce platform risk and increase conversion. Goal: deliver a unified P2 Epic that closes Upwork-style gaps before migrations and routes are committed.

## Target users / ICP roles
- Freelancers (independent contractors seeking visibility and verification)
- Clients/Employers (hirers needing reliable search, badges, and compliant engagement)
- Platform Admins (managing taxonomy, promotions, and compliance flags)

## Scope
- Portfolio basics and samples
- Taxonomy definition + advanced filters/search
- Verification badges
- Promoted listings
- Tax compliance workflows
- Employment classification logic
- Supporting migrations, backend routes, and frontend components (no production code staged)

## Functional requirements
- Freelancers can create and manage portfolio samples with media and skill tags
- Platform applies standardized taxonomy supporting advanced filters (skills, rates, location, verification status)
- Verification badges awarded via admin or third-party flows with visible status on profiles
- Promoted listings purchasable and surfaced in search results with clear labeling
- Tax forms and withholding rules enforced at onboarding and payout
- Employment classification engine evaluates engagement type and surfaces required disclosures

## Acceptance criteria
- All listed migrations (0300–0309) produce valid schemas that support the described features
- Backend routes expose CRUD and query endpoints for portfolios, taxonomy, badges, promotions, tax, and classification
- Frontend components render portfolios, filter UI, badges, promoted slots, and compliance notices without errors
- Search returns results filtered by taxonomy, verification, and promotion priority within defined latency
- Tax and classification flows block non-compliant actions and log required records

## Out of scope
- Production deployment or data seeding
- Mobile-specific implementations
- Analytics dashboards or reporting
- International tax regimes beyond initial supported jurisdictions
- Full Upwork gap analysis integration (pending snapshot)

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._