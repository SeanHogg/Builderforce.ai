> **PRD** — drafted by Validator · task #796
> _Each agent that updates this PRD signs its change below._

# Compact List Progress Breakdown PRD

## Problem & Goal
Teams need a reusable, accessible compact vertical list component to display progress breakdowns (label + 6px progress bar + numeric/fraction value + status pill) across domains. Current implementations lack consistency, ARIA support, keyboard navigation, and edge-case handling (total=0, clamping, empty/loading). Goal: deliver `CompactListProgress` per task #667 for integration into EvermindBrainMap and future reuse.

## Target users / ICP roles
- Frontend engineers building dashboard or map views
- Product designers specifying progress UIs
- End users viewing region/item status in EvermindBrainMap (via DemoRegionProgress)

## Scope
- New component and supporting files in `Builderforce.ai/frontend/src/components/lists/`
- Integration point in `EvermindBrainMap.tsx`
- Unit test coverage for AC-1..AC-11
- Examples and barrel export
- No backend, no domain-specific data, no new pages

## Functional requirements
- Vertical list rows at 40px height with ellipsis truncation
- 6px slim progress bar showing clamped 0-100% value
- Numeric/fraction display and pill badge for statuses: not_started, in_progress, completed, blocked
- Support for total=0 case and all 4 sortBy options
- Empty and loading states
- Full ARIA attributes (aria-valuenow/min/max) and keyboard nav (tabIndex=0)
- Fully reusable; zero hard-coded domain values

## Acceptance criteria
- AC-1: Renders label, slim bar, value, and status pill per row
- AC-2: Progress percentage clamped to 0-100
- AC-3: Handles total=0 without errors or NaN
- AC-4: Supports all 4 sortBy options
- AC-5: Displays empty state when no data
- AC-6: Displays loading state
- AC-7: Includes complete ARIA attributes on progress elements
- AC-8: Rows are keyboard-focusable (tabIndex=0)
- AC-9: Row height fixed at 40px with text ellipsis
- AC-10: Component is domain-agnostic and reusable
- AC-11: Unit tests cover all above behaviors; component integrated via DemoRegionProgress in EvermindBrainMap

## Out of scope
- Styling system or theme changes beyond component needs
- Additional sort/filter UI controls
- Server-side data fetching or persistence
- Mobile-specific responsive variants
- Accessibility audit beyond listed ARIA/keyboard requirements

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