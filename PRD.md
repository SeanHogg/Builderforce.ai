> **PRD** — drafted by Ada (Sr. Product Mgr) · task #772
> _Each agent that updates this PRD signs its change below._

# Agent-to-Role Assignment Tool PRD

## Problem & Goal
Manual assignment of agents to manifest-defined roles for tasks and epics is error-prone, slow, and cannot be scripted for automation. There is no programmatic way to populate a specific role within a task or epic with a given agent (human or bot). This prevents automated orchestration of work allocation, dynamic staffing, and integration with CI/CD or workflow engines.

**Goal:** Provide a simple, reliable API (and optional CLI) that accepts a task or epic identifier, a manifest role name, and an agent reference (agentRef), then assigns that agent to the role. The assignment must respect the existing manifest definition and be usable from automation.

## Target users / ICP roles
- **DevOps Engineers & SREs** – Automating work dispatch from pipelines.
- **Project/Program Managers** – Bulk or programmatic assignment across initiatives.
- **Workflow Automation Scripts** – Integrating with event-driven systems (e.g., when a PR is created).
- **Platform Teams** – Building higher-level orchestration services on top of the assignment capability.

## Scope
- Implementation of an **API endpoint** (`POST /tasks/{taskId}/roles/{roleName}/agent`) that accepts an `agentRef` and updates the assignment for the specified task/epic.
- A corresponding **CLI command** (e.g., `cli assign-agent --task <ref> --role <name> --agent <agentRef>`) that calls the API.
- Validation logic to ensure:
  - The task/epic exists.
  - The given role name exists within the manifest of that task/epic.
  - The agentRef refers to a known, active agent.
- Clear error responses for missing entities, duplicate assignments, and permission issues.
- Idempotent behaviour: assigning the same agent to the same role on the same task yields a success (200 OK) with no side effects beyond the initial creation.
- Logging of assignment events.
- Respect of existing authentication/authorization – only callers with appropriate permissions can perform the assignment.

## Functional requirements
1. **API endpoint**  
   - Method: `POST`  
   - Path: `/tasks/{taskId}/roles/{roleName}/agent`  
   - Request body: `{ "agentRef": "<string>" }` (valid UUID or external ID)  
   - Success response: `200 OK` with updated role assignment details.  
   - Idempotency: if the same agent is already assigned, return `200` with no change.  
   - Errors:  
     - `404` if task or role not found.  
     - `422` if role exists in manifest but cannot accept an agent (e.g., system-only).  
     - `409` if the role is already assigned to a *different* agent and no overwrite flag is set.  
     - `400` for malformed input.  
     - `403` for insufficient permissions.  

2. **CLI command**  
   - `assign-agent --task <taskRef> --role <roleName> --agent <agentRef>`  
   - Optional flag `--force` to overwrite an existing assignment (conflict resolver).  
   - Outputs human-readable confirmation or error.  

3. **Input validation**  
   - taskId/taskRef must resolve to an existing task or epic.  
   - roleName must match a role defined in the task/epic manifest.  
   - agentRef must correspond to an active agent entity.  

4. **Audit log**  
   - Each assignment attempt is logged with timestamp, caller, task, role, agent, and result.  

5. **Security**  
   - Uses existing authentication tokens / session.  
   - Requires role `task.assign` or equivalent permission.  

## Acceptance criteria
- [ ] **Happy path:** A valid `POST` with correct taskId, role, and agentRef returns 200 and the assignment is persisted.  
- [ ] **Idempotency:** Repeated identical requests return 200 without changing state.  
- [ ] **Conflict:** Trying to assign a different agent to an already-assigned role returns 409; with `--force` flag (or `?force=true` query param) overwrites the assignment and returns 200.  
- [ ] **Missing task:** Using a non-existent taskId returns 404 with a descriptive error message.  
- [ ] **Invalid role:** Using a role not present in the task manifest returns 404, clearly stating the role is not defined for that task.  
- [ ] **Invalid agent:** Using an unknown agentRef returns 400 (or 422) with a message indicating the agent does not exist.  
- [ ] **Permission denied:** An unauthenticated or unauthorized request returns 403.  
- [ ] **Audit trail:** Assignment events appear in the audit log with correct details.  
- [ ] **CLI mirror:** The CLI command succeeds and fails under the same conditions as the API, with user-friendly messaging.

## Out of scope
- Creating or modifying manifest roles themselves (role definition stays in the task/epic manifest editor).
- Bulk assignment across multiple tasks in a single API call.
- Notifications or subscription triggers (e.g., “send email on assignment”) – these are handled by a separate eventing system, not this tool.
- Any user interface changes (the API/CLI only; UI teams can build on top).
- Agent lifecycle management (onboarding, deactivation) – the system must already support agent entities.
- Conflict resolution policies beyond simple overwrite (no merge, no priority-based reassignment).

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