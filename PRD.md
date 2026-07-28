> **PRD** — drafted by Product Manager · task #519
> _Each agent that updates this PRD signs its change below._

# Taxonomy and Filter Design Layer PRD

## Problem & Goal
A temporary design layer for job category taxonomy and filter types is required for governance alignment (task #380 GAP P2-11) but must not ship in the current branch or codebase. The goal is to isolate these assets as a one-time cleanup placeholder that will be removed in a follow-up to prevent planning bias, ensuring integration surfaces are addressed first.

## Target users / ICP roles
- Internal governance and planning teams only (no end-user or customer impact).

## Scope
- Provisionally include `Job-category-taxonomy.json` and `filter-types.ts` as non-shippable reference files.
- Mark the entire layer for future removal post-integration.
- Exclude any filter landing pages, UI components, or runtime usage.

## Functional requirements
- Store taxonomy definitions in `Job-category-taxonomy.json` for governance review.
- Define filter type contracts in `filter-types.ts` without exposing them to application logic.
- Add explicit non-shipment markers and comments referencing task #380.
- Ensure the layer remains isolated from build, test, and deployment pipelines.

## Acceptance criteria
- Files exist only as placeholders with clear "PRE-REMOVE" and "governance-only" annotations.
- No references appear in shipped code, configs, or documentation.
- Follow-up removal task is linked and ready for execution once integration surfaces are available.
- PR review confirms zero risk of accidental inclusion in the branch.

## Out of scope
- Any filter UI, landing pages, or production integration.
- Updates to taxonomy content beyond placeholder structure.
- Shipping or enabling the layer in any environment.

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