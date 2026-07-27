> **PRD** — drafted by Validator · task #711
> _Each agent that updates this PRD signs its change below._

# PRD: Compact List Progress Breakdown (Task #667)

## Problem & Goal
List views lack a compact, reusable way to display item-level progress breakdowns, leading to inconsistent UI and repeated implementation effort.  
Goal: Deliver a self-contained `CompactListProgress` component with helpers, tests, examples, and two verified integration points that renders progress without data-layer changes.

## Target Users / ICP Roles
- Frontend engineers integrating list components
- Product managers and designers reviewing list UX
- End users viewing progress in project and brain-map list views

## Scope
- New component, test suite, barrel export, usage examples, and PRD copy
- Integration into `EvermindBrainMap.tsx` via `DemoRegionProgress`
- Post-merge verification in one additional existing list view
- No backend, data-model, or API modifications

## Functional Requirements
FR-1: Accept `ProgressItem[]` input shape with id, label, value, max, and optional status.  
FR-2: Render compact horizontal progress segments or bars in a single row.  
FR-3: Support color mapping by status (complete, in-progress, blocked, not-started).  
FR-4: Display aggregate percentage and item count summary.  
FR-5: Provide accessible labels and ARIA attributes for screen readers.  
FR-6: Expose TypeScript types and pure helper functions for calculations.  
FR-7: Include responsive sizing and truncation for long labels.  
FR-8: Support theming via existing design tokens.

## Acceptance Criteria
AC-1: `CompactListProgress.tsx` renders without console errors or type issues.  
AC-2: All unit tests in `CompactListProgress.test.tsx` pass with ≥90% coverage.  
AC-3: Barrel export in `index.ts` allows import as `@/components/lists`.  
AC-4: `CompactListProgress.examples.tsx` demonstrates at least three usage variants.  
AC-5: `PRD.md` is committed alongside implementation.  
AC-6: `EvermindBrainMap.tsx` integrates via `DemoRegionProgress` using existing props.  
AC-7: Component height ≤ 32 px in default compact mode.  
AC-8: Percentage calculation matches helper output exactly.  
AC-9: Status colors match design-system palette.  
AC-10: No layout shift when values update.  
AC-11: Zero data-layer or store changes required.  
AC-12: Component used in at least two distinct list views after merge.

## Out of Scope
- Backend progress aggregation or persistence
- New data models or API endpoints
- Animation libraries or heavy charting
- Mobile-specific gesture handling
- Localization beyond existing i18n setup

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