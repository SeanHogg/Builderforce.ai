> **PRD** — drafted by Ada (Sr. Product Mgr) · task #824
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Duplicate entries in the system lead to:
- Confusion among users
- Inaccurate data analysis
- Increased storage costs
- Potential errors in business processes

### Goal
Ensure that the system effectively identifies and removes duplicate entries, maintaining data integrity and improving user experience.

## Target Users / ICP Roles

- **Data Analysts**: Require accurate and clean data for reporting and analysis.
- **Customer Support Representatives**: Need to access correct customer information to provide effective support.
- **System Administrators**: Responsible for maintaining system health and performance.
- **End Users**: Expect a seamless and error-free experience when interacting with the system.

## Scope

- **Detection**: Implement a mechanism to detect duplicate entries based on predefined criteria.
- **Notification**: Notify relevant stakeholders when duplicates are detected.
- **Removal**: Provide functionality to remove duplicate entries automatically or manually.
- **Prevention**: Implement measures to prevent future duplicate entries.

## Functional Requirements

1. **Duplicate Detection**
   - System must identify duplicates based on unique identifiers (e.g., email, user ID) and/or combination of fields (e.g., name and phone number).
   - Detection should be configurable to allow for different criteria based on data type and use case.

2. **Notification System**
   - Send alerts to administrators and relevant users when duplicates are detected.
   - Include details of the duplicate entries, such as the fields that matched and the number of duplicates found.

3. **Removal Functionality**
   - Provide options to remove duplicates automatically based on predefined rules (e.g., keep the most recent entry).
   - Allow manual review and removal of duplicates through a user interface.
   - Ensure that removal actions are logged for auditing purposes.

4. **Prevention Measures**
   - Implement real-time validation to prevent the creation of new duplicate entries.
   - Provide feedback to users during data entry if a potential duplicate is detected.

5. **Reporting**
   - Generate reports on the number of duplicates detected and removed over time.
   - Include metrics on the effectiveness of duplicate prevention measures.

## Acceptance Criteria

- **Detection**: System correctly identifies duplicates based on specified criteria with a 99% accuracy rate.
- **Notification**: Notifications are sent within 5 minutes of duplicate detection.
- **Removal**: 
  - Automatic removal processes complete within 1 hour.
  - Manual removal actions are completed by users without errors.
- **Prevention**: No new duplicates are created after implementation, verified through testing.
- **Reporting**: Reports are generated accurately and are accessible through the admin dashboard.

## Out of Scope

- **Historical Data Cleanup**: Addressing duplicates in historical data prior to the implementation of this feature.
- **Third-Party Integrations**: Handling duplicates that originate from third-party systems or integrations.
- **Complex Data Relationships**: Managing duplicates in data with complex relationships or hierarchies.
- **User Training**: Developing training materials or conducting training sessions for users on the new duplicate management features.
- **Advanced Analytics**: Incorporating machine learning or advanced analytics for predictive duplicate detection.

## Requirements

### 1. Removal Capability — As-Built

`TicketParticipantsService.removeParticipant(env, tenantId, taskId, participantId)` already exists in
`api/src/application/kanban/ticketParticipants.ts`. It deletes from `ticket_participants` matching
**all** of `tenantId`, `taskId`, `id = participantId`, **and `source IN ('assessment','manual')`**,
then bumps the manifest cache version.

**BA finding — two constraints that determine whether verification can pass:**

- **F-1 — `template`-sourced rows cannot be removed.** The `inArray(source, ['assessment','manual'])`
  predicate means a duplicate whose provenance is `template` (or `lane_agent`) matches zero rows.
  Re-deriving the manifest re-inserts template slots idempotently, so a template duplicate is
  *by design* not removable — it must be corrected at the `swimlane_requirements` template instead.
- **F-2 — the delete is silent.** It returns `void` and does not report the affected row count, so a
  no-op delete is indistinguishable from a successful one by the caller. Verification therefore
  **must not** trust the call's return; it must re-read the manifest (§3).

**Requirement:** removal is considered *specified* by the as-built method. No new tool is required for
an `assessment`/`manual` duplicate. If Epic #709's participant `0d6423f1-…` is `template`-sourced,
this ticket's verification will legitimately FAIL and the fix belongs in the board template — that
outcome is a valid, reportable result, not a defect in this verification.

### 2. Duplicate Detection Criteria

A **duplicate participant** is defined as:
- Two or more rows in `ticket_participants` sharing identical values for:
  - `taskId`
  - `stageKey` (nullable, treated as NULL match)
  - `roleKey`
  - `responsibility` (owner | reviewer | contributor)
  - `source` (`template` | `assessment` | `manual` | `lane_agent`)

This is enforced by the unique index `uidx_ticket_participants_slot` on `(task_id, stage_key, role_key, responsibility, source)`.

**Example from Epic #709:**
- Row A: `roleKey='engineer'`, `stageKey='development'`, `source='assessment'` (participantId: `0d6423f1-ff54-40fc-9e0a-082956af913f`)
- Row B: `roleKey='engineer'`, `stageKey=NULL`, `source='template'`
- Rows A and B are NOT duplicates (different stageKey + source), but two rows with identical `(stageKey, roleKey, responsibility, source)` are.

### 3. Verification Criteria

**"The duplicate entry is gone" is verified when:**

1. **Query:** `SELECT * FROM ticket_participants WHERE task_id = 709 AND id = '0d6423f1-ff54-40fc-9e0a-082956af913f'` returns **no rows**.

2. **Manifest consistency:** GET `/api/kanban/tasks/709/participants` does **not include** a participant with `id = 0d6423f1-ff54-40fc-9e0a-082956af913f`.

3. **No orphan gaps introduced:** The manifest still contains the required roles (Owner, Engineer, Designer, Security) — removing the duplicate `engineer—development` slot does not leave an unstaffed gap because the generic `engineer` role (sourced from the template) remains.

### 4. Traceability

| Requirement ID | Description | Verification |
|---------------|-------------|--------------|
| REQ-824-1 | Remove participant tool deletes row by participantId | SELECT returns no row |
| REQ-824-2 | Manifest cache invalidated after removal | API reflects removal |
| REQ-824-3 | Duplicate defined by unique slot (taskId, stageKey, roleKey, responsibility, source) | Unique index enforces |
| REQ-824-4 | Epic #709 duplicate removed | participantId 0d6423f1... absent |

---

**Authored by:** Business Analyst (this ticket)  
**PRD owner:** Ada (Sr. Product Mgr)  
**Last updated:** 2026-08-04

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._