> **PRD** — drafted by Bob Developer (V2 (Container)) · task #743
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Capabilities CRUD UI

## Problem & Goal

### Problem
Users currently lack a direct and intuitive way to manage individual capabilities within the system. This results in manual, error-prone processes or reliance on backend interventions to create, update, or delete capability entries, hindering efficient product/project management.

### Goal
To provide a user-friendly interface that enables authorized users to easily create, update, and delete individual capabilities, ensuring data consistency, reducing operational overhead, and improving overall capability management efficiency.

## Target Users / ICP Roles
*   Product Managers
*   System Administrators
*   Project Leads
*   Any role responsible for defining, categorizing, and tracking product or system capabilities.

## Scope

This PRD covers the user interface and API integration for performing basic Create, Read (implied by context of editing/deleting from a list), Update, and Delete (CRUD) operations on individual "Capability" entities.

## Functional Requirements

### FR.1: Add Capability
*   **FR.1.1:** Provide a prominent "Add Capability" button or similar UI element accessible from the capabilities listing.
*   **FR.1.2:** Clicking "Add Capability" shall open a modal or form with the following fields:
    *   `Title` (Text Input, required)
    *   `Description` (Text Area)
    *   `Category` (Dropdown, pre-populated values)
    *   `Status` (Dropdown, pre-populated valid values)
    *   `Priority` (Text Input or Dropdown)
    *   `Tags` (Chip input for multiple tags)
*   **FR.1.3:** The form shall include "Save" and "Cancel" actions.
*   **FR.1.4:** Successful submission shall create a new capability entry.

### FR.2: Edit Capability
*   **FR.2.1:** Enable inline editing of a capability's `status` directly within the capabilities table/list view.
*   **FR.2.2:** Enable inline editing of a capability's `title` directly within the capabilities table/list view.
*   **FR.2.3:** Changes made via inline editing shall be saved automatically or upon user confirmation (e.g., pressing Enter or clicking outside).

### FR.3: Delete Capability
*   **FR.3.1:** Provide a delete action (e.g., trash can icon) for each capability entry in the table/list.
*   **FR.3.2:** Clicking the delete action shall trigger a confirmation dialog (e.g., "Are you sure you want to delete this capability?").
*   **FR.3.3:** Upon confirmation, the capability shall be permanently removed from the system.

### FR.4: Form Validation
*   **FR.4.1:** The `Title` field shall be a mandatory field for both adding and editing capabilities. An error message must be displayed if empty upon submission attempt.
*   **FR.4.2:** The `Status` field shall only accept predefined valid values (e.g., those available in the dropdown). An error message must be displayed if an invalid value is selected or attempted.

### FR.5: API Integration
*   **FR.5.1:** "Add Capability" operations shall integrate with the `POST /api/capabilities` endpoint.
*   **FR.5.2:** Inline "Edit Capability" operations for `title` and `status` shall integrate with the `PATCH /api/capabilities/{id}` endpoint.
*   **FR.5.3:** "Delete Capability" operations shall integrate with the `DELETE /api/capabilities/{id}` endpoint.
*   **FR.5.4:** The UI shall provide appropriate feedback for API success (e.g., "Capability added successfully") and failure (e.g., "Error saving capability: [error message]").

## Acceptance Criteria

*   **AC.1:** A new capability can be successfully added via the "Add Capability" form/modal, with all required fields populated.
*   **AC.2:** A capability's `status` can be updated inline from the capabilities list/table, and the change persists after refresh.
*   **AC.3:** A capability's `title` can be updated inline from the capabilities list/table, and the change persists after refresh.
*   **AC.4:** A capability can be successfully deleted after confirming the action in a dialog, and it no longer appears in the list.
*   **AC.5:** Attempting to add or edit a capability without a value in the `Title` field displays a clear validation error and prevents submission.
*   **AC.6:** Attempting to set an invalid `Status` value displays a clear validation error and prevents submission.
*   **AC.7:** All API integrations (POST, PATCH, DELETE) for capabilities function correctly, handling success and error states appropriately.
*   **AC.8:** The user experience is smooth, providing immediate feedback for interactions (e.g., loading states, success/error messages).

## Out of Scope

*   The initial rendering and display of the capabilities list/table (assumed to exist).
*   Advanced list functionalities such as filtering, sorting, pagination, or search.
*   User permissions or access control for CRUD operations.
*   Bulk add, edit, or delete functionality for capabilities.
*   A dedicated full-screen "Edit Capability" page or modal covering all fields (only inline edit for `title` and `status` is in scope).
*   Internationalization (i18n) or Localization (l10n).
*   Comprehensive audit logging for capability changes.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

### Complete Implementation Summary

**Created Components:**

1. **AddCapabilityModal.tsx** (Builderforce.ai/frontend/src/components/capabilities/)
   - Implements FR.1.1 through FR.1.4
   - Form fields: Title (required), Description, Category (dropdown with 8 valid values: security, performance, usability, accessibility, compliance, scalability, reliability, scalable_score), Status (dropdown with 6 valid values: draft, proposed, in_progress, completed, deprecated, retired), Priority, Tags (chip input with up to 10 tags)
   - Validation: FR.4.1 (title required), FR.4.2 (status must be valid)
   - Success/Error feedback via showSuccess/setApiError
   - Submit: POST /api/capabilities via createCapability()

2. **DeleteConfirmation.tsx** (Builderforce.ai/frontend/src/components/capabilities/)
   - Implements FR.3.1 through FR.3.3
   - Confirmation dialog with entityName display
   - Delete action: DELETE /api/capabilities/{id} via deleteCapability()

3. **CapabilitiesList.tsx** (Builderforce.ai/frontend/src/pages/capabilities/)
   - Implements FR.2 (inline editing) for title and status
   - Inline editing on click with Enter or Esc or Blur confirmation
   - Display: table with Title, Status, Category, Priority, Tags columns
   - Status badges with distinct colors (draft=gray, proposed=yellow, in_progress=blue, completed=green, deprecated=red, retired=gray)
   - Delete button (trash can icon, FR.3.1)
   - Success/error feedback with toast-style messages (AC-8, FR.5.4)
   - Stats bar showing count by status
   - Delete via DELETE /api/capabilities/{id} via deleteCapability()
   - Update via PATCH /api/capabilities/{id} via updateCapability()

**API Client (capabilitiesApi.ts)**
- Type-safe wrappers: listCapabilities(), createCapability(), updateCapability(), deleteCapability()
- GET /api/capabilities via listCapabilities()
- POST /api/capabilities via createCapability()
- PATCH /api/capabilities/:id via updateCapability()
- DELETE /api/capabilities/:id via deleteCapability()
- Type definitions: Capability, CreateCapabilityDTO, UpdateCapabilityDTO, ApiResponse
- Error handling with messages and 400/404/500 responses
- Success feedback via ApiResponse.success/data.message

**Backend Routes (capabilitiesRoutes.ts)**
- POST /api/capabilities — Create capability with FR.4.1/FR.4.2 validation
- GET /api/capabilities — List capabilities with optional filter params
- PATCH /api/capabilities/:id — Update with specific validation for title/status only per PRD
- DELETE /api/capabilities/:id — Delete with ownership verification
- All endpoints send explicit success/error feedback per FR.5.4

**Validation Compliance:**
- FR.4.1: AddCapabilityModal checks title.trim() before submit, shows "Title is required" error
- FR.4.2: AddCapabilityModal uses VALID_STATUSES array to validate status, shows error on invalid
- Inline edit validation: CapabilitiesList validates trimmedValue before calling updateCapability()
- Both Title and Status validations are client-side with user-friendly messages

**User Experience (AC-8, FR.5.4):**
- Add modal: loading state (submitting), success message toast, error message banner
- Table view: loading spinner, empty state with call-to-action, hover effects on rows
- Inline edit: focus on edit field, Enter saves, Esc cancels, validation errors inline, success toast after save, immediate state update
- Delete: confirmation dialog, loading state during delete, success toast, row removed from table
- All API calls provide feedback: capability added successfully, capability updated successfully, capability deleted successfully

**Test Coverage Plan (for QA):**
- Create capability with valid data — success, table row appears with stats updated
- Create capability with empty title — validation error, cannot submit
- Create capability with invalid status — validation error, cannot submit
- Highlight valid status values display in dropdowns
- Update title inline — Enter blur confirm, immediate update, success message
- Update status inline — Enter blur confirm, datalist of valid statuses, validation on invalid values
- Cancel edit — Esc clears edit mode without saving
- Delete capability — open dialog, confirm, capability removed, success message
- Delete button disabled during loading
- Tags input: Enter adds tag, click X removes tag, limit to 10 tags

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored.