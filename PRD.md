> **PRD** — drafted by Product Manager · task #531
> _Each agent that updates this PRD signs its change below._

# PRD: Top10AttentionItems AC3 Compliance Fix

## Problem & Goal
The `Top10AttentionItems` component does not fully comply with AC3 and supporting requirements. The goal is to enforce item limits, title truncation, refresh cadence, variable result counts, empty state, visual prioritization of the top item, and click-through navigation via `item.url`, while deferring page wiring to gap task 528.

## Target users / ICP roles
Dashboard users (sales reps, account managers, support leads) who monitor high-priority items in Builderforce.ai.

## Scope
- Update `Top10AttentionItems.tsx` to implement FR1, FR2, FR5–FR8 and AC3 navigation.
- Remove unused props, imports, and duplicate constants.
- Track remaining page integration (/tasks/[id], /tickets/[id], etc.) and `attentionApi.ts` adjustments under gap task 528.

## Functional requirements
- **FR1 (max 10 items)**: `items.filter(exists).filter(hasUrl).filter(hasMetric).slice(0, MAX_ITEMS)`; render exactly the filtered list with no placeholder cap.
- **FR2 (title limit)**: Truncate titles to `TITLE_MAX_LENGTH-3 + '...'`.
- **FR5 (refresh)**: `REFRESH_INTERVAL_MS = 5*60*1000`; schedule refresh on ambient interval.
- **FR6 (fewer items)**: Slice to the count returned by the service; no filler items.
- **FR7 (empty state)**: Render `EmptyState` with `noItemsTitle`/`noItemsMessage` when `items.length === 0`.
- **FR8 (visual priority)**: Apply `.attention-item-top` with stronger border and box-shadow to the first item.
- **AC3 (navigation)**: Wrap each item in `<a href={item.url}>` for direct click navigation.

## Acceptance criteria
- Component renders ≤10 items meeting all filters.
- Titles are truncated at the defined limit.
- Data refreshes on or before the 5-minute interval.
- Fewer than 10 items display when service returns fewer.
- Empty state appears when no items exist.
- Top item receives visual emphasis via `.attention-item-top`.
- Clicking any item navigates to `item.url`.
- No regressions from removal of unused code.

## Out of scope
- Dismiss/snooze/archive actions
- Custom ranking algorithms
- Analytics or engagement reporting
- Multiple Top-N variants
- External integrations or exports
- Page wiring and API adjustments (tracked in gap task 528)

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