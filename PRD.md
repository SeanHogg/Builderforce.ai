> **PRD** — drafted by Validator · task #708
> _Each agent that updates this PRD signs its change below._

# Compact List Progress Breakdown Component (Task #667)

## Problem & Goal
Teams need a reusable, visually compact component to display list-level progress breakdowns (progress bar, percentage/fraction, status) within dense UIs such as maps and dashboards. Goal: deliver a production-ready, accessible, sortable component that handles edge cases and integrates without domain-specific data coupling.

## Target users / ICP roles
- Frontend engineers building list/map views in Builderforce.ai
- Product designers specifying dense data visualizations
- End users viewing progress across regions or lists in EvermindBrainMap and similar surfaces

## Scope
- New `CompactListProgress` component and supporting exports
- Unit test coverage for all specified behaviors
- Integration example in `EvermindBrainMap.tsx`
- Barrel export via `index.ts`
- Limited to listed files and ACs; no new backend or data models

## Functional requirements
- FR-1: Render progress bar, percentage, and fraction values
- FR-2: Display status badges
- FR-3: Safe handling when total=0 and clamp percentages to 0-100
- FR-4: Enforce visual density (≤40px row height, 6px progress bar)
- FR-5: Support sorting by progress_asc, progress_desc, status, label_asc
- FR-6: Provide empty and loading states with skeletons
- FR-7: Full ARIA support and keyboard navigation
- FR-8: Domain-agnostic reusability with no hardcoded data references

## Acceptance criteria
- AC-1–AC-11 and FG: All behaviors in FR-1–FR-8 pass unit tests; component renders correctly in DemoRegionProgress integration; no accessibility or density regressions

## Out of scope
- Additional sorting options or custom themes
- Backend progress calculation or data fetching
- Usage beyond listed files or new feature flags
- Mobile-specific responsive variants
- Analytics instrumentation

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