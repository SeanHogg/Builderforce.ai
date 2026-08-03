> **PRD** — drafted by Ada (Sr. Product Mgr) · task #894
> _Each agent that updates this PRD signs its change below._

# PRD: Bulk Archive/Delete for Flagged Items

## Problem & Goal
Currently, users can only archive or delete a single flagged item at a time. This is inefficient when managing a large volume of inappropriate or low-quality content, leading to repetitive manual actions and increased moderation time. The goal is to enable users to select multiple flagged items and archive or delete them in a single action, significantly improving moderation workflow speed and reducing operational toil.

## Target Users / ICP Roles
- **Content Moderators** – responsible for reviewing and acting on flagged content; need to quickly clear obvious violations in bulk.
- **Community Managers / Admins** – oversee overall content health and often perform clean-up operations on flagged queues.
- **Workspace Owners** – may intervene during high-volume incidents (e.g., spam attacks) and require batch removal capabilities.

## Scope
This enhancement introduces a multi-select UI and corresponding backend endpoints that allow users to archive or delete multiple flagged items simultaneously. The feature must be accessible from any view where flagged items are listed (e.g., moderation queue, search results filtered by flag status). It covers:
- Frontend multi-select controls and bulk action buttons.
- Backend API for bulk archive and bulk delete.
- Confirmation dialogs with impact summary.
- Progress indication and eventual consistency handling.
- Basic error handling (partial failures, permission checks).

## Functional Requirements

- **FR-1: Multi-Select Toggle**
  - The UI provides a “Select” mode (e.g., checkboxes on each item row, a “Select All” control).
  - Selecting items counts the chosen items and activates bulk action buttons.

- **FR-2: Bulk Archive Action**
  - User can trigger “Archive” on selected flagged items via a button.
  - A confirmation dialog shows the number of items to be archived and any irreversible consequences.
  - Upon confirmation, a single API call is made to archive all selected items (respecting per-item permissions).
  - Successful archival removes the items from the active flagged view (or marks them as archived).

- **FR-3: Bulk Delete Action**
  - User can trigger “Delete” on selected flagged items via a button.
  - A confirmation dialog warns about permanent deletion and lists the count of items.
  - Upon confirmation, a single API call is made to permanently delete the items.
  - Deleted items are immediately removed from the UI; an optional “Undo” toast may be provided for a short time (if technically feasible).

- **FR-4: Bulk Endpoint**
  - A new POST endpoint (`/api/v1/flagged-items/bulk-archive` and `/api/v1/flagged-items/bulk-delete`) accepts an array of item IDs.
  - The endpoint validates user permissions for each item; any unauthorized items are excluded and reported in the response.
  - For large batches, the operation is processed asynchronously and returns a job ID for status polling; for smaller batches (≤100), a synchronous response with summary is acceptable.

- **FR-5: Error & Edge Case Handling**
  - If no items are selected, bulk actions are disabled.
  - If the user lacks permission for all selected items, the action is prevented with an appropriate error message.
  - Partial success: display how many items were successfully archived/deleted vs. failures (with reasons).
  - Network interruption during bulk request: show error and allow retry.

- **FR-6: UI States**
  - Loading state: button shows a spinner and becomes disabled during the request.
  - Empty state: after all items in the current view are archived/deleted, an empty state message is displayed.
  - A clear way to exit selection mode (e.g., “Cancel” button or pressing Escape) is provided.

## Acceptance Criteria

- **AC-1:** As a moderator, I can select multiple flagged items using checkboxes or “Select All” and the UI reflects the count of selected items.
- **AC-2:** When I choose “Archive” for selected items, a confirmation dialog appears; upon confirming, the items are archived and disappear from the flagged queue.
- **AC-3:** When I choose “Delete” for selected items, a confirmation dialog appears; upon confirming, the items are permanently deleted and removed from the UI.
- **AC-4:** If I attempt a bulk action on items I do not have permission to modify, the operation is rejected or skips those items, and I am notified.
- **AC-5:** For batches of 100 items or fewer, the operation completes synchronously within 3 seconds and the UI updates immediately.
- **AC-6:** For batches larger than 100 items, the system returns a job ID and the UI shows a progress indicator; once complete, the view refreshes.
- **AC-7:** Bulk actions are accessible from the main moderation queue and any saved filtered view of flagged items.
- **AC-8:** The feature is keyboard navigable and meets WCAG 2.1 level AA accessibility standards for selection, buttons, and dialogs.

## Out of Scope
- **Bulk restore** of archived items (archived items can be individually restored; batch restore will be addressed separately).
- **Scheduling** bulk actions (e.g., “archive all flagged items older than 30 days”).
- **Bulk actions across multiple workspaces** or across different item types (e.g., flagged posts + comments mixed).
- **Customizable confirmation thresholds** (e.g., suppress confirmation for <5 items).
- **Undo after delete** – the feature may offer a short-lived “Undo” toast as a nice-to-have, but permanent deletion guarantees are not required.

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