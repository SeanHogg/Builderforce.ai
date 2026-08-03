> **PRD** — drafted by Ada (Sr. Product Mgr) · task #829
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Auto-resolve Owner Role from Epic Assignee

## Problem & Goal
**Problem:** When an issue is created under an epic, the Owner role does not automatically inherit the epic’s assignee. This requires manual assignment, introduces human error, and causes ownership misalignment across the epic’s work breakdown.

**Goal:** Automatically resolve the `Owner` role for an issue to the epic’s assignee, ensuring consistent ownership propagation. The immediate verification target is epic assignee **Ada** (user ID `fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`).

## Target Users / ICP Roles
- **Project Managers / Team Leads** who define epics and expect consistent ownership without manual per-issue assignment.
- **Developers & Product Owners** who create, triage, or pick up issues and rely on accurate Owner metadata.
- **System Administrators** who configure automation rules and audit role assignments.

## Scope
- **In scope:**  
  Automatic resolution of the `Owner` field on issue creation and epic-link changes, based solely on the parent epic’s current assignee.  
  Verification that the rule correctly fires for Ada (`fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`).  
  Handling of epic assignee updates (proactive re-resolution for all un-overridden child issues).  
  Proper behaviour when the epic has no assignee.

## Functional Requirements
1. **Issue creation / linkage**  
   When an issue is associated with an epic that has an assignee, the issue’s `Owner` field must be set to that assignee without user intervention.

2. **Epic assignee change**  
   If the epic’s assignee changes, all open issues belonging to that epic must have their `Owner` field updated to the new assignee, **unless** a user has manually overridden the `Owner` on an individual issue (explicit override preserves manual value).

3. **No-assignee fallback**  
   If the parent epic has no assignee, the `Owner` field must remain blank (no fallback assignment).

4. **Audit trail**  
   Automatic `Owner` changes must be recorded as system-generated activity for traceability.

5. **Performance**  
   Resolution must complete within **5 seconds** of the trigger event (issue creation, linkage, or epic assignee change).

6. **Specific user verification**  
   The rule must be explicitly validated for user Ada (`fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`).

## Acceptance Criteria
1. **AC1 – Creation with assigned epic**  
   **Given** an epic with assignee Ada (`fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`)  
   **When** a new issue is created and linked to that epic  
   **Then** the issue’s `Owner` field is automatically set to Ada, visible immediately upon creation.

2. **AC2 – Epic assignee change propagates**  
   **Given** an epic with assignee Ada and two open child issues (both have `Owner` = Ada, neither has a manual override)  
   **When** the epic assignee is changed to another user (e.g., `Bob`)  
   **Then** both child issues’ `Owner` fields are updated to `Bob` within 5 seconds.

3. **AC3 – Manual override persists**  
   **Given** a child issue whose `Owner` was manually set to `Charlie` (overriding the epic’s Ada)  
   **When** the epic assignee changes from Ada to `Dana`  
   **Then** the issue’s `Owner` remains `Charlie` and is **not** overwritten.

4. **AC4 – No assignee on epic**  
   **Given** an epic with **no** assignee  
   **When** a new issue is created under that epic  
   **Then** the issue’s `Owner` field remains blank.

5. **AC5 – Audit log capture**  
   **Given** any automatic `Owner` assignment or update  
   **When** the change occurs  
   **Then** the issue’s activity history contains a system entry describing the change (e.g., “Owner automatically set from epic assignee”).

## Out of Scope
- Automation of roles other than `Owner` (e.g., Reviewer, Approver, QA).
- Bulk backfill of `Owner` on existing issues that pre-date this automation.
- Resolution across multi-level hierarchies (e.g., epic → story → sub-task); only direct epic-to-issue relationship is covered.
- UI configuration or user preferences to opt out of auto-assignment (default behaviour applies globally).
- Custom fallback assignment logic when an epic has no assignee (e.g., defaulting to the project lead).

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