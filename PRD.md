> **PRD** — drafted by Ada (Sr. Product Mgr) · task #400
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Chat Rename Feature

## 1. Problem & Goal

### 1.1 Problem
Users currently lack the ability to customize the titles of their chats, leading to difficulty in identifying, organizing, and quickly navigating through conversations, especially as the number of chats grows. Default titles (often based on the first message) can be unhelpful or misleading over time.

### 1.2 Goal
Enable users to easily rename their existing chats to custom titles, thereby improving chat discoverability, organization, and overall user experience within the platform.

## 2. Target Users / ICP Roles

All users of the chat platform.

## 3. Scope

This PRD covers the functionality for users to rename an individual existing chat. This includes the UI interaction for initiating the rename, inputting a new title, backend persistence of the new title, and propagation of the new title to relevant UI elements.

## 4. Functional Requirements

*   **FR1: Initiate Rename Action:** The system must provide a clear and intuitive way for a user to initiate a rename action on an existing chat (e.g., a "Rename" option in a context menu or an editable title field).
*   **FR2: Input New Title:** The system must allow the user to input a new title for the selected chat.
*   **FR3: Title Validation:** The system must validate the new title input for constraints such as character limit (e.g., 1-100 characters) and forbidden characters.
*   **FR4: Backend Update:** Upon successful input, the system must update the `title` attribute of the specified chat ID in the backend database. This maps to the `builtin_brain_update({ id, title })` operation.
*   **FR5: UI Update:** The system must immediately reflect the new title in all relevant UI components, including the chat list and the active chat header.
*   **FR6: Title Persistence:** The new title must be persistently stored and displayed consistently across user sessions and device accesses.
*   **FR7: Error Handling:** The system must provide clear feedback to the user if the rename operation fails due (e.g., due to invalid input or a backend error).

## 5. Acceptance Criteria

*   **AC1:** A user can select an existing chat and successfully change its title via the provided UI.
*   **AC2:** After renaming, the new title is immediately displayed in the chat list, the chat header, and any other relevant UI elements.
*   **AC3:** The new chat title persists after the user closes and reopens the application or navigates away and back to the chat.
*   **AC4:** If a user attempts to save an invalid title (e.g., exceeding character limits), an appropriate error message is displayed, and the original title remains unchanged.
*   **AC5:** The rename operation is performant, completing within expected UI responsiveness times (e.g., under 500ms for UI update).

## 6. Out of Scope

*   Batch renaming of multiple chats.
*   AI-generated or suggested chat titles.
*   Version history or auditing of chat title changes.
*   Specific permissions or roles for renaming chats (it's assumed users can rename their own chats).
*   Automatic title generation based on chat content.
*   Renaming of system-generated or immutable chat titles.