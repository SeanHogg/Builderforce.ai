> **PRD** — drafted by Product Manager · task #532
> _Each agent that updates this PRD signs its change below._

# Top10AttentionItems AC3 Fix PRD

## Problem & Goal
The Top10AttentionItems component requires an AC3 navigation fix to wrap items in `<a href={item.url}>` anchors, removal of unused props (`isFirst`, `isLoading`), cleanup of the `calculateScore` import and duplicate constants, and enforcement of FR1–FR8 compliance. This ensures typed, accessible navigation while maintaining existing behavior for list limits, truncation, refresh, empty states, and visual priority. Remaining page-level wiring is deferred.

## Target users / ICP roles
Dashboard users and operators who monitor high-priority attention items (tasks, tickets, alerts) in Builderforce.ai.

## Scope
- Update `Top10AttentionItems.tsx` only.
- Implement clickable `<a>` navigation (AC3).
- Update `RenderedItemProps`; remove unused props and imports.
- Consolidate duplicate constants.
- Enforce FR1–FR8 via existing slice/content logic.
- Track page integration in gap task 528.

## Functional requirements
- **FR1**: Display maximum 10 items via `slice(0, MAX_ITEMS)`.
- **FR2**: Truncate titles to 100 characters (`slice(0, TITLE_MAX_LENGTH - 3) + '...'`).
- **FR5**: Refresh list on `REFRESH_INTERVAL_MS = 5 * 60 * 1000` interval.
- **FR6**: Show fewer items when the source returns fewer than MAX_ITEMS.
- **FR7**: Render `EmptyState` when `items.length === 0`.
- **FR8**: Apply stronger border and box-shadow to `.attention-item-top` for visual priority.
- **AC3**: Use `<a href={item.url}>` for typed navigation (replaces `role="button"` div).

## Acceptance criteria
- Each list item renders as `<a href={item.url}>` with correct URL.
- `RenderedItemProps` no longer includes `isFirst` or `isLoading`.
- Unused `calculateScore` import removed; duplicate constants consolidated.
- All FR1–FR8 behaviors verified via slice and content logic.
- No visual or behavioral regressions in list rendering or refresh.

## Out of scope
- Page integration for navigation targets (tracked in gap task 528).
- Dismiss/snooze/archive UX, custom algorithms, analytics, multiple Top-N variants, external integrations, or exports.

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