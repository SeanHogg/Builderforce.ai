> **PRD** — drafted by Product Manager · task #520
> _Each agent that updates this PRD signs its change below._

# PRD: Discipline Placeholder Governance (#380)

## Problem & Goal
During the farewell/metadata-design-layer stage, a temporary governance placeholder is required to preserve workflow smoothness. search_discipline and search_uri must remain unused until job/freelancer re-mapping explicitly surfaces the database-vs-taxonomy decision. Discipline must stay optional through the integration gate to avoid premature coupling.

## Target users / ICP roles
Internal platform engineers and governance reviewers responsible for metadata integration.

## Scope
- Introduce a single optional discipline placeholder field and associated metadata layer.
- Enforce non-usage of search_discipline/search_uri paths.
- Gate discipline behind an explicit re-mapping trigger (future work).
- One-time implementation only; no ongoing taxonomy or search logic.

## Functional requirements
- Add optional `discipline` field (string, nullable) to relevant domain models.
- Prevent any code paths from referencing or invoking search_discipline/search_uri.
- Surface discipline only as a passive metadata holder until re-mapping event occurs.
- Maintain existing job and freelancer creation/update flows without discipline enforcement.

## Acceptance criteria
- Discipline field accepts null/empty values without blocking any workflow.
- No references to search_discipline or search_uri exist in the codebase post-merge.
- Integration tests confirm placeholder remains inert until explicit re-mapping flag is set.
- PR review passes governance checklist for metadata-design-layer stage.

## Out of scope
- Job/freelancer re-mapping implementation.
- Database vs taxonomy resolution.
- Any search or filtering behavior based on discipline.
- Production-facing UI or API exposure of discipline values.

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