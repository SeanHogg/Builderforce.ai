> **PRD** — drafted by Ada (Sr. Product Mgr) · task #889
> _Each agent that updates this PRD signs its change below._

# PRD: Effort Estimation Visibility on Manager Backlog View

## Problem & Goal
**Problem**: The Manager Backlog view (ManagerBacklogItem component) does not display any effort estimation (Story Points, T‑shirt sizes) for backlog items, despite PRD FR‑4 requiring prominent, persistent visibility of this attribute. No effort field exists in the backend model or API responses, leaving managers without essential sizing information during backlog refinement and prioritization.

**Goal**: Make effort estimation (Story Points and T‑shirt sizes) visible on every backlog item in the Manager Backlog view so that product managers and engineering leads can quickly assess relative sizing without extra clicks or context switches.

## Target Users / ICP Roles
- Product Managers
- Engineering Managers
- Scrum Masters / Agile Coaches  
*(Any role with access to the Manager Backlog view who needs to size and prioritize work)*

## Scope
- **Backend**: Add effort estimation fields to the backlog item data model; create and run a database schema migration; expose the fields in the API DTO and all relevant GET endpoints that populate the Manager Backlog.
- **API**: Include `storyPoints` (nullable integer) and `tShirtSize` (nullable string/enum) in the JSON response for backlog item queries.
- **Frontend**: Render the effort estimation prominently inside the `ManagerBacklogItem` component using a clear, consistent format.
- **Persistence**: The displayed information must reflect the stored values and survive page reloads or navigation.

## Functional Requirements
1. **Data Model & Migration**  
   - Backlog item table/collection must gain two new columns/properties: `storyPoints` (integer, nullable) and `tShirtSize` (string, nullable, limited to `XS`, `S`, `M`, `L`, `XL` or `—`).  
   - A migration script shall add these columns without data loss and apply appropriate defaults (NULL).

2. **API DTO Update**  
   - The `BacklogItem` DTO returned by relevant GET endpoints (e.g., `GET /api/backlog`) shall include an `effort` object:  
     ```json
     {
       "storyPoints": 5,
       "tShirtSize": "M"
     }
     ```
   - The API must gracefully handle null values for both fields and not alter existing response schemas beyond this addition.

3. **UI Rendering – `ManagerBacklogItem`**  
   - The component must display effort estimation in a prominent location (e.g., below the title or in a dedicated badge).  
   - Formatting rules:
     - If both `storyPoints` and `tShirtSize` are present: show `SP: 5 · Size: M`.
     - If only one value exists: show `SP: 8` or `Size: L`.
     - If neither value exists: show `—` or omit the section.
   - The display must be non‑editable and respect the component’s existing visual hierarchy.

4. **No Breakage**  
   - The new fields must not alter the layout or functionality of other views (e.g., Team Member view, Backlog Item Detail) unless those views later opt in to display effort.

## Acceptance Criteria
1. **API Response**: When a backlog item is fetched via any API endpoint that powers the Manager Backlog, the response includes an `effort` object with nullable `storyPoints` and `tShirtSize`. Existing end‑to‑end tests are updated to validate the new schema.
2. **Database Migration**: After running the migration, all existing backlog items retain their data, and new items can have effort values set (even if not editable from the manager view yet).
3. **Manager View Rendering**:
   - Each row/card in `ManagerBacklogItem` shows the effort estimation exactly as specified, using the current values from the API.
   - The display handles all combinations of null/non‑null values without errors or layout shifts.
   - The component matches the visual design mockups (provided by the designer) in terms of positioning, typography, and colour.
4. **Read‑Only Display**: Clicking or interacting with the effort display triggers no edit mode; the component remains strictly informational.
5. **Cross‑View Integrity**: The Manager view’s loading, empty, and error states remain unaffected. No regression in other backlog item views.

## Out of Scope
- In‑line editing or any UI that allows managers to modify effort estimation directly from the `ManagerBacklogItem` – this belongs to backlog item detail/edit forms (separate feature).
- Effort visibility in other backlog views (e.g., Team Member view, Sprint Planning board) unless explicitly requested in a future scope expansion.
- Backend endpoints for batch update or bulk import of effort values.
- Analytics, reporting, or filters based on effort estimation fields.
- Enhancements to the workflow for assigning effort (e.g., preset defaults, suggestions based on title).

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