> **PRD** — drafted by John Coder ((V2) (Durable)) · task #746
> _Each agent that updates this PRD signs its change below._

# PRD: Implement `kanban_remove_participant` Tool

## Problem & Goal
AI agents occasionally mis-assign participants to tasks, leading to incorrect accountability tracking in the Participation Manifest. The current process for correcting mis-assignments is manual, error-prone, and lacks traceability.

**Goal**: Implement a built-in tool (`kanban_remove_participant`) that enables AI agents to programmatically remove a participant entry from a task's Participation Manifest. This will:
- Correct mis-assignments efficiently.
- Maintain data integrity by adjusting downstream statuses.
- Provide a traceable audit trail for removals.

---

## Target Users / ICP Roles
This tool is **not** directly exposed to end-users. It serves:
1. **AI Agents**: Autonomous or semi-autonomous agents managing task workflows.
2. **System Integrators**: Teams building automations around task management.
3. **Product Teams**: Ensuring data consistency in the Participation Manifest.

---

## Scope
### In Scope
1. **Tool Implementation**:
   - New built-in function `kanban_remove_participant` with the signature:
     ```typescript
     kanban_remove_participant(taskId: string, identifier: { roleKey: string } | { participantEntryId: string }): Promise<boolean>
     ```
   - Validation of inputs (`taskId` and either `roleKey` or `participantEntryId`).
   - Removal of the specified participant entry from the Participation Manifest.
   - Downstream status adjustments (e.g., recalculating task status if the removed participant was critical).

2. **Data Integrity**:
   - Atomic operation: Either succeeds entirely or fails without partial updates.
   - Log removal events for auditing.

3. **Testing**:
   - Unit tests for validation, removal logic, and downstream effects.
   - Integration tests for tool invocation by AI agents.

### Out of Scope
1. **End-user UI**: No changes to the frontend for this tool.
2. **Bulk Operations**: Removing multiple participants in one call.
3. **Undo Functionality**: No built-in rollback mechanism.
4. **Notification System**: No automatic notifications to removed participants.
5. **Permission Checks**: Assume the calling agent has permissions (handled upstream).

---

## Functional Requirements
| ID  | Requirement                                                                 | Notes                                                                 |
|-----|-----------------------------------------------------------------------------|-----------------------------------------------------------------------|
| FR1 | **Input Validation**                                                        | Reject invalid `taskId` or missing `roleKey`/`participantEntryId`.    |
| FR2 | **Exclusive Identifier**                                                    | Accept *either* `roleKey` **or** `participantEntryId`, not both.      |
| FR3 | **Manifest Update**                                                         | Remove the specified participant row from the Participation Manifest. |
| FR4 | **Downstream Status Adjustment**                                            | Recalculate task status (e.g., clear "In Progress" if assignee removed). |
| FR5 | **Idempotency**                                                             | Return `true` if removal succeeds; `false` if participant doesn’t exist. |
| FR6 | **Audit Logging**                                                           | Log removal events (who, when, what) for traceability.                |
| FR7 | **Atomicity**                                                               | Ensure no partial updates if removal fails.                           |
| FR8 | **Test Coverage**                                                           | Unit/integration tests for all above requirements.                    |

---

## Acceptance Criteria
### Functional AC
1. **Tool Invocation**:
   - AI agents can call `kanban_remove_participant` with `taskId + roleKey` **or** `taskId + participantEntryId`.
   - Tool returns `true` on success, `false` if participant doesn’t exist.

2. **Data Changes**:
   - Participant entry is removed from the Participation Manifest.
   - Downstream task status is updated if required (e.g., no assignee → task is "Unassigned").

3. **Error Handling**:
   - Throws clear errors for:
     - Invalid `taskId` (e.g., non-existent task).
     - Missing `roleKey` and `participantEntryId`.
     - Caller lacks permissions (handled upstream).

### Non-Functional AC
1. **Performance**:
   - Operation completes in <100ms for 95% of requests.

2. **Testing**:
   - 100% unit test coverage for validation, removal, and error cases.
   - Integration tests verify tool works when invoked by AI agents.

---

## Out of Scope (Redundant but Explicit)
- **UI Changes**: No frontend modifications.
- **Bulk Operations**: Single-participant removal only.
- **Permissions**: Assumed handled by the calling agent.
- **Notifications**: No emails/slack messages to removed participants.
- **Rollback**: No undo functionality.

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