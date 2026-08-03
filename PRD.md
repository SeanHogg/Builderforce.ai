> **PRD** — drafted by Ada (Sr. Product Mgr) · task #655
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: StakeholderMapService.ts

## Problem & Goal
The Stakeholder Alignment Diagnostic (#503) is missing its core domain logic. Without a dedicated service, there is no way to detect conflicts when two stakeholders submit conflicting P0 priorities for the same team within a review window, nor any defined sign‑off state machine (Approve / Approve-with-Comment / Block → escalation). This gap blocks delivery of the alignment feature.  
**Goal**: Deliver `StakeholderMapService.ts`, a self‑contained domain service that encapsulates stakeholder map conflict detection and the sign‑off state machine, exposing at least one primary export for integration.

## Target Users / ICP Roles
- **Backend/domain developers** integrating stakeholder alignment workflows (direct consumers of the service).
- **Product managers and team leads** who use the alignment diagnostic to resolve priority conflicts and track sign‑off statuses (indirect beneficiaries).

## Scope
- Single TypeScript file: `StakeholderMapService.ts`.
- Domain logic for:
  - Detecting conflicts: two different P0 priorities for the same team, both submitted within the active review window.
  - Sign‑off state machine: transitions between `Approve`, `Approve‑with‑Comment`, `Block`, and automatic escalation after `Block`.
- Export at least one primary class or function (e.g., `StakeholderMapService` class or factory function).

## Functional Requirements
1. **Conflict Detection**
   - Given a team identifier and a review window timeframe, compare the submitted P0s of all stakeholders who have submitted during that window.
   - Return a conflict flag (and optionally the conflicting stakeholders and their P0s) when two or more distinct P0 values exist.
   - If all submitted P0s are identical or only one submission exists, no conflict.

2. **Sign‑Off State Machine**
   - Support states: `Pending`, `Approved`, `ApprovedWithComment`, `Blocked`.
   - Valid transitions:
     - `Pending` → `Approved` (via `approve()` action)
     - `Pending` → `ApprovedWithComment` (via `approveWithComment()`)
     - `Pending` → `Blocked` (via `block()`)
     - `Blocked` → automatically triggers an escalation event (logic to emit or return an escalation object, not handle notification).
   - Invalid transitions (e.g., `Approved` → `Blocked`) must be rejected with an appropriate error or result.
   - Optional: record transition timestamp and actor for audit trail.

3. **Service Export**
   - Export at least one primary construct (class or function) that presents these capabilities. The export must be importable by other modules.

4. **Input/Output Contracts**
   - Conflict detection input: team ID, list of submissions (each with stakeholder ID, P0 priority, timestamp), review window start/end.
   - Conflict detection output: object with `hasConflict: boolean`, and optionally `conflicts: { stakeholderIds, priorities }[]`.
   - State machine input: current state, action type, payload (e.g., comment text for ApproveWithComment).
   - State machine output: new state and any side‑effect events (e.g., escalation event).

## Acceptance Criteria
1. The file `StakeholderMapService.ts` exists in the repository and contains no syntax errors.
2. Export at least one class/function that is referenced (or expected to be referenced) by other parts of the system.
3. Unit tests (or demonstrable invocation) confirm:
   - Two stakeholders submitting different P0s for the same team inside the window → `hasConflict: true`.
   - Two stakeholders submitting the same P0 → `hasConflict: false`.
   - Only one stakeholder submission → `hasConflict: false`.
4. State machine tests:
   - `Pending` + `approve()` → `Approved`.
   - `Pending` + `approveWithComment("looks good")` → `ApprovedWithComment` (comment stored).
   - `Pending` + `block()` → `Blocked`, and an escalation event is produced.
   - Transitions from `Approved`, `ApprovedWithComment`, or `Blocked` with an invalid action throw an error or return a rejected result.
5. All AC items for the GAP’s three assets must be individually fulfilled; this service is the first asset and must stand alone as a deliverable.

## Out of Scope
- **Schema/type file** (`stakeholder-profile.ts` or equivalent structured health‑profile schema) – separate asset.
- **Migration** `0340_stakeholder_maps.sql` (DDL for tables) – separate asset.
- **UI components**, API endpoints, or notification delivery (escalation event consumers).
- **Persistence logic** – the service operates on in‑memory inputs and returns results; no database access.
- **Authentication/authorization** – consuming layer is responsible for caller context.

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