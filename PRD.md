> **PRD** — drafted by Ada (Sr. Product Mgr) · task #887
> _Each agent that updates this PRD signs its change below._

# PRD: Bulk Archive/Delete for Flagged Items

## Problem & Goal
Moderators currently must archive or delete flagged items one at a time, which is slow and error-prone when handling multiple items. FR-2/AC-2 from [parent feature doc] specifies the ability to select multiple flagged items and archive/delete them in a single action, but no UI or API support exists.

**Goal:** Provide an efficient bulk action workflow so that authorized users can select multiple flagged items and archive or delete them in one step, reducing effort and improving moderation throughput.

## Target Users / ICP Roles
- **Content Moderators:** Need to quickly clear queues of resolved or invalid flags.
- **Admins/Owners:** Need to bulk-remove spam or outdated flagged content.
- **Security Analysts (if applicable):** Triage large volumes of flagged items during incidents.

## Scope
- User interface additions to the flagged items list: selection checkboxes, select‑all toggle, bulk action buttons.
- Client‑side state management for multi‑selection across pages (if paginated) or current view.
- New server‑side endpoints:
  - `PATCH /api/flagged-items/bulk/archive` (mark multiple as archived)
  - `DELETE /api/flagged-items/bulk` (permanent deletion)
- Confirmation dialogs with progress indicators.
- Backend validation: user permissions, existence of items, prevention of duplicate operations.
- Audit logging for bulk actions.

## Functional Requirements
### FR1: Multi‑select UI
- FR1.1: A checkbox appears at the beginning of each flagged item row.
- FR1.2: A checkbox in the table header “selects all” visible items on the current page.
- FR1.3: Selecting/deselecting individual items updates the selection state; “select all” state reflects whether all visible items are selected (indeterminate state if only some are selected).
- FR1.4: State persists if the user navigates to the next page? *Decision:* Selection is scoped to the current page only to keep implementation simple; clearing the selection when pagination changes. *(If cross‑page bulk is required, add it explicitly later.)*

### FR2: Bulk Action Buttons
- FR2.1: When at least one item is selected, a toolbar or floating action bar appears with two buttons: “Archive” and “Delete”.
- FR2.2: Buttons are disabled if the user lacks write permission on any selected item (or a tooltip explains permission mismatch).
- FR2.3: Clicking “Archive” opens a confirmation modal showing the count of items and the action; on confirm, calls the bulk archive endpoint.
- FR2.4: Clicking “Delete” opens a confirmation modal warning that deletion is permanent and cannot be undone; on confirm, calls the bulk delete endpoint.
- FR2.5: During the operation, show a loading state (e.g., spinner; optionally progress bar for large batches). On success, refresh the list and clear selection; on error, display an error message and do not clear selection so user can retry.

### FR3: Bulk Archive Endpoint
- FR3.1: Accepts `POST /api/flagged-items/bulk/archive` with a JSON body `{ "ids": ["uuid1", "uuid2", ...] }`.
- FR3.2: Validates that the user has write access to every item.
- FR3.3: Performs an idempotent update: marks each item’s `status` or `archived` flag as `archived`, sets `archived_at` timestamp, and logs the action.
- FR3.4: Returns a summary: `{ "archived_count": 3, "failed_ids": [], "errors": [] }`.

### FR4: Bulk Delete Endpoint
- FR4.1: Accepts `POST /api/flagged-items/bulk/delete` with `{ "ids": [...] }`.
- FR4.2: Validates write access and item existence.
- FR4.3: Permanently removes the items (or soft‑deletes if archiving is soft; but requirement says “delete” – implement permanent deletion with appropriate safeguards).
- FR4.4: Returns summary similar to above.

### FR5: Permissions & Error Handling
- FR5.1: If the user lacks permission for any item, the entire request fails with a 403 and a list of unauthorized IDs. *(Alternative: process only allowed ones and report failures; for simplicity, fail whole batch.)*
- FR5.2: If some IDs are invalid or not found, return 400 with details.
- FR5.3: If the server encounters a partial failure during processing (e.g., DB error on some items), the response indicates which items succeeded and which failed, allowing the client to retry accordingly.

### FR6: State Management (Client)
- FR6.1: Use component state or a context store to maintain selected IDs as a Set.
- FR6.2: On deselect/unselect, remove ID from the set; on “select all”, add all visible IDs; clearing selection resets the set.
- FR6.3: After successful bulk operation, clear selection and refetch the flagged items list.

## Acceptance Criteria
1. **AC1 (UI checkboxes):** A checkbox is rendered next to each flagged item row and a header checkbox toggles selection of all items on the current page.
2. **AC2 (Bulk actions visible):** The “Archive” and “Delete” buttons appear only when one or more items are selected; they are hidden when none are selected.
3. **AC3 (Confirmation dialogs):** Clicking Archive/Delete shows a modal summarizing the number of items and the action; proceeding triggers the API call.
4. **AC4 (Successful archive):** After confirming archive, the selected items disappear from the active list (status updated), a success toast appears, and selection is cleared.
5. **AC5 (Successful delete):** After confirming delete, the items are removed from the list permanently, success toast, selection cleared.
6. **AC6 (Permission error):** If a user attempts to bulk‑act on items they cannot modify, the operation fails with a clear error message, and the selection remains intact.
7. **AC7 (Invalid IDs):** If the request payload contains IDs that don’t exist, the API returns a 400 with details, and the UI shows an appropriate error.
8. **AC8 (API payload limits):** The server must reject requests with more than 100 IDs to prevent performance issues (configurable limit). A 413 status is returned if exceeded.
9. **AC9 (Loading state):** The UI is disabled and a loading indicator is shown during the API request.

## Out of Scope
- **Cross‑page bulk selection:** Selection does not persist across pagination; bulk applies only to items currently visible. *(Will be addressed in a future iteration if needed.)*
- **Undo functionality:** No undo/restore for archived or deleted items.
- **Bulk actions other than archive/delete:** e.g., bulk mute, bulk assign, bulk tag.
- **Advanced filters for bulk selection:** no “select all matching filter” across pages.
- **Real‑time progress for large batches:** no WebSocket streaming; simple spinner suffices.
- **Bulk actions on non‑flagged items:** this is specific to the flagged items view.

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