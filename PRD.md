> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1531
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Retroactive Kanban Signoff for Task #579

## Problem & Goal
The Business Analyst (Kevin) authored and committed the "Requirements" section of the PRD for task #579, fulfilling the `business-analyst` role's deliverable. However, all attempts to record the corresponding kanban signoff (`roleKey: business-analyst`, `laneKey: backlog`, `verdict: approved`) failed with HTTP 401 ("Token has been revoked or expired"). The accountability slot remains officially unfulfilled despite the completed work, creating an integrity gap in the board's tracking and downstream automation that depends on signoff states.

**Goal:** Enable the system (or an authorized operator) to retroactively apply the missing signoff to task #579, restoring board integrity without requiring the original contributor to re-authenticate or re-submit artifacts that already exist.

## Target Users / ICP Roles
- **Kanban board maintainers / DevOps leads** responsible for board state integrity and reprocessing stuck workflows.
- **Automated governance services** that consume signoff verdicts to enforce Definition of Done (DoD) gates.

## Scope
- Provide a mechanism to record a signoff on task #579 for `roleKey=business-analyst` in `laneKey=backlog` with `verdict=approved`.
- Link the signoff to existing deliverable evidence (the committed Requirements section in `builderforce/task-579`).
- Ensure the signoff is idempotent and does not disrupt subsequent lane transitions for the same role.

## Functional Requirements
1. **Retroactive Signoff Endpoint / Operation**
   - The system shall accept an authenticated request to apply a signoff to a specific task, role, and lane, bypassing the normal requirement that the original `contributor` token is still valid.
   - The signoff record must include a reference to the already-committed deliverable (branch `builderforce/task-579`, commit sha).

2. **Authorization Model**
   - Only users or service accounts with a `ROLE_BOARD_ADMIN` or equivalent elevated permission may execute a retroactive signoff.
   - Approval workflow (manual validation by an admin that the deliverable exists and is acceptable) must be logged.

3. **Audit Trail & Signoff Payload**
   - The signoff event must be persisted with:
     - `roleKey`: `business-analyst`
     - `laneKey`: `backlog`
     - `verdict`: `approved`
     - `contributor`: Kevin (user ID)
     - `signoff_timestamp`: current time of retroactive application
     - `evidence`: link to the PRD Requirements commit
     - `applied_by`: admin user ID
     - `reason`: "Retroactive application due to auth failure during original attempt; deliverable verified in commit <sha>."
   - The event must appear in the task’s history timeline with a distinct flag indicating it was applied retroactively.

4. **Board State Consistency**
   - After the retroactive signoff is applied, the kanban board state for task #579 must reflect the fulfilled accountability slot identically to a normally recorded signoff.
   - Any downstream DoD checks or automation triggered by `business-analyst:approved in backlog` must be equivalently satisfied.

## Acceptance Criteria
1. **Happy Path – Retroactive Signoff Applied**
   - *Given* an admin user authenticated with `ROLE_BOARD_ADMIN` and the commit `abc123` on `builderforce/task-579` containing the completed Requirements section
   - *When* the admin calls the retroactive-signoff operation for task #579 with `roleKey=business-analyst`, `laneKey=backlog`, `verdict=approved`, contributor=Kevin, evidence=commit `abc123`
   - *Then* the system returns HTTP 201, the task’s business-analyst slot in backlog shows `approved`, the event is logged with retroactive metadata, and any gating rules for `business-analyst:approved` are evaluated.

2. **Idempotency**
   - *Given* the above signoff already exists
   - *When* the same retroactive request is repeated
   - *Then* the system returns HTTP 200 (or 409 with a clear message) and does not create a duplicate signoff or alter existing state.

3. **Authorization**
   - *Given* a user without `ROLE_BOARD_ADMIN`
   - *When* they attempt a retroactive signoff
   - *Then* the system returns HTTP 403 Forbidden.

4. **No Disruption**
   - *Given* the task later transitions the business-analyst role to a subsequent lane (e.g., `in-progress` or `review`)
   - *When* the new signoff is recorded
   - *Then* the retroactively applied `backlog:approved` does not interfere, and the board enforces correct lane sequencing.

## Out of Scope
- Fixing the root cause of the 401 token revocation for the original contributor (this PRD covers only the data repair for task #579).
- Building a general-purpose "override any signoff" API without guardrails—scope is strictly limited to admins resolving verified false-negative auth failures where deliverables are already auditable in version control.
- Altering signoff records for any role other than `business-analyst` or lanes other than `backlog` on this task.
- Auto-detection of similar situations across other tasks.

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