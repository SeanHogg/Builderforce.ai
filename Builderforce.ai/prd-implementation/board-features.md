# Board Feature Implementation Notes: Blocked Items

## Overview
This document describes how the Blocked Items feature FR1.1–FR1.8, AC1.1–AC1.6 should be implemented in the existing board-based task management system.

## Core Data Model
Each task has the following fields relevant to blocked items:
- `isBlocked`: boolean (default false). Indicates whether the task is currently blocked.
- `blockerReason`: string | null (nullable). Stores the reason for blocking; must not exceed 255 characters.
- `updatedAt`: ISO timestamp (unless adding/updating blockerReason or isBlocked).

## Recipe: Adding “Blocked” to a Board/Task
1. Select the board’s task row.
2. For inline toggling (FR1.1, FR1.6):
   - Include a block toggle in the context menu or in the card to mark/unmark the task.
   - Trigger a PATCH `/api/board/tickets/:id` (or equivalent per-board endpoint) to update:
     - `isBlocked`
     - `blockerReason` (if marking blocked, required; otherwise cleared if nullify_allowed is true)
3. Provide a modal/inline detail for the blockerReason (FR1.2, FR1.8):
   - When blocked, a text input is shown with maxLength 255.
   - When unblocked (FR1.8), reason must be cleared (nullified).
4. Persist updates via existing board API (same family as `PATCH /board/tickets/:id`), returning the refreshed row JSON with `isBlocked` and `blockerReason`.

## Visual Indicator (FR1.4)
1. Render a red flag icon adjacent to blocked rows in the board, list, and on-hover tooltip (or separate badge) to visually differentiate them from active rows.
2. Support a reusable `BlockerBadge` component that toggles according to `isBlocked` and shows `blockerReason` in the tooltip.

## Filtering (FR1.5)
1. Provide a “Show only blocked tasks” filter/select in the board/list view.
2. When active, the board renders only rows where `isBlocked` is true.

## Implementation Hints
- Use the existing BoardCard React component (or derive from it).
- Ensure that `PATCH /board/tickets/:id` rejects partial success if both `isBlocked` is true and `blockerReason` is null/empty (must provide required text).
- For unblocking, accept a request that clears `blockerReason` if `nullify_allowed` is supported; otherwise store an empty string.

## Related File References
- `Builderforce.ai/frontend/src/components/board/BoardCard.tsx`
- `Builderforce.ai/frontend/src/components/board/BlockerBadge.tsx`
- `Builderforce.ai/frontend/src/components/board/BlockerDrawer.tsx`
- `Builderforce.ai/frontend/src/components/board/__generated.ts`

## Pending Questions
- Are there distinct UI surfaces for “Blocked” vs. “In Progress/Done”? If so, apply the same indicator everywhere.
- Do we allow multiple reasons (list.append_reasons) or just a single reasoning string?