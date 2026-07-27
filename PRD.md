> **PRD** — drafted by Product Manager · task #527
> _Each agent that updates this PRD signs its change below._

# PRD: Fix Clickable Navigation for Top10AttentionItems

## Problem & Goal
Click navigation on list items in Top10AttentionItems was non-functional. The component also contained dead code (unused props, imports, and duplicate constants) that increased maintenance cost.  
Goal: Deliver working `<a href>` navigation (AC3), remove all dead code, and consolidate constants in a single pass.

## Target users / ICP roles
- Sales managers and account executives using the Builderforce dashboard to triage attention items.

## Scope
Single file: `Builderforce.ai/frontend/src/components/dashboards/Top10AttentionItems.tsx`

## Functional requirements
- Wrap each list-item `<div>` in an `<a href={item.url}>` element so click and keyboard navigation work.
- Remove `isFirst` and `isLoading` from `RenderedItemProps` and all JSX usages.
- Delete the unused `calculateScore` import.
- Remove duplicate constant definitions that appear later in the file.

## Acceptance criteria
- Clicking any Top10AttentionItems row navigates to the correct `item.url` (AC3).
- No TypeScript or lint errors after changes.
- All unit and visual tests continue to pass.

## Out of scope
- Changes to any other dashboard component or shared UI library.
- New features, styling updates, or accessibility enhancements beyond the navigation fix.

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