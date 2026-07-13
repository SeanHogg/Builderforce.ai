> **PRD** — drafted by John Coder ((V2) (Durable)) · task #793
> _Each agent that updates this PRD signs its change below._

## Product Requirements Document: Assign Agent to Existing Participation Manifest Role

### Problem & Goal

**Problem:** Project Managers currently lack a platform tool to assign an agent to an *existing* unstaffed role within a task's participation manifest. The only existing tool creates *new* roles, forcing inefficient workarounds or manual manifest manipulation when staffing pre-defined roles.

**Goal:** To provide Project Managers with a dedicated platform tool to efficiently assign an agent to an already-created, unstaffed manifest role, thereby streamlining the process of staffing epic requirements without needing to re-create roles.

### Target Users / ICP Roles

*   **Project Manager:** The primary user responsible for staffing tasks and epics.

### Scope

Develop a new backend platform tool (`kanban_assign_participant`) that enables Project Managers to:

1.  Specify an existing `taskId`, `roleKey`, and the `assigneeRef` of an agent.
2.  Update the state of the specified participant role from `unstaffed` to `assigned` with the given agent.
3.  Handle cases where a role is already assigned by overwriting the existing assignment (reassigning).
4.  Perform necessary input validation to ensure data integrity.

### Functional Requirements

*   **FR1:** A new backend API endpoint / internal function, `kanban_assign_participant`, must be created.
*   **FR2:** The `kanban_assign_participant` tool must accept the following inputs:
    *   `taskId` (number): The identifier for the epic/task whose manifest is being updated.
    *   `roleKey` (string): The key identifying the role within the manifest to which the agent will be assigned (e.g., "engineer").
    *   `assigneeRef` (string): The unique reference ID of the agent/user to be assigned.
    *   `assigneeKind` (string): Specifies the type of assignee, either "user" or "agent".
*   **FR3:** The tool must successfully update the participant's state within the task's manifest from `unstaffed` to `assigned`.
*   **FR4:** If the specified participant `roleKey` is already `assigned`, the tool must overwrite the existing assignment with the new `assigneeRef` and `assigneeKind`.
*   **FR5:** The tool must include validation to ensure:
    *   The `taskId` corresponds to an existing task.
    *   The `roleKey` exists within the specified task's manifest.
    *   The participant corresponding to `roleKey` exists in the manifest.
    *   The `assigneeRef` refers to a valid agent/user.

### Acceptance Criteria

1.  A new platform tool `kanban_assign_participant` is created with these inputs:
    *   `taskId` (number) — the epic/task whose manifest to update
    *   `roleKey` (string) — the role key to assign (e.g., "engineer")
    *   `assigneeRef` (string) — the agent/user ref to assign
    *   `assigneeKind` (string) — "user" or "agent"
2.  The tool updates the participant's state from `unstaffed` to `assigned`.
3.  The Epic #709 Engineer role (participantId: 04d5c723-8249-46ef-a1d0-49b214646c90) is successfully assigned to John Coder (ref: 658608ba-59ab-4ec3-873d-211a89ea000f) when `kanban_assign_participant` is invoked with the relevant parameters.

### Out of Scope

*   Creation of new participation manifest roles (existing tools cover this).
*   Functionality to unassign an agent from a role.
*   Management of agent availability, capacity, or skill matching.
*   Development of a user interface (UI) for this tool; it is a backend API/internal function.
*   Deletion or modification of manifest roles (other than assignment status).

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

## Acceptance

_Owned by the validator — to be authored._