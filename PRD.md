> **PRD** — drafted by Validator · task #866
> _Each agent that updates this PRD signs its change below._

# PRD: Compact List Progress Breakdown (Task #667)

## Problem & Goal
Users need a reusable, scannable compact progress list for status tracking in dashboards and maps. Goal: deliver `CompactListProgress` with sortable rows, status badges, progress bars, total=0 safety, accessibility, and keyboard navigation; integrate into EvermindBrainMap without data mutation.

## Target Users / ICP Roles
- Product managers and engineering leads viewing task/sprint status
- Builders using EvermindBrainMap for progress overviews
- Accessibility-focused developers requiring ARIA and keyboard support

## Scope
Implement `CompactListProgress` component, helpers, examples, tests, barrel exports, and EvermindBrainMap demo usage. Cover FR-1–FR-8 and AC-1–AC-12. Include owner sign-off in PRD.md.

## Functional Requirements
- FR-1: Render `ProgressItem[]` with label, value, total, status
- FR-2: Compute and display percentage with `toPercent`/`formatPct`
- FR-3: Per-row status badges using `STATUS_VALUES`/`STATUS_LABELS`/`STATUS_ICONS` and `getColorByStatus`
- FR-4: Horizontal progress bars (max 6 px) with truncation
- FR-5: Sorting by `progress_desc`, `progress_asc`, `status`, `label_asc`
- FR-6: Empty, loading, and total=0 safe states
- FR-7: Keyboard navigation and ARIA attributes
- FR-8: Reusable pattern; no domain-specific data

## Acceptance Criteria
- AC-1..AC-12: All sorting, percentage, blocked color, truncation, empty/loading, ARIA, viewport density, accessibility, and reusability tests pass
- DemoRegionProgress visible in EvermindBrainMap.tsx without side effects
- 12 test suites cover FR-2, helpers, and edge cases
- PRD.md signed off by Ada with governance and integration trace

## Out of Scope
- Data-layer mutations or backend changes
- Non-compact density variants
- Additional domains beyond EvermindBrainMap demo

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