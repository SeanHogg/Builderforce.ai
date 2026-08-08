> **PRD** — drafted by Ada (Sr. Product Mgr) · task #772
> _Each agent that updates this PRD signs its change below._
>
> **Business Analyst** (BA-1) — Requirements authored · 2025-06-25
> _Architect_ — pending
> _Developer_ — pending
> _Code Reviewer_ — pending
> _QA Tester_ — pending

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
- Notifications or subscription triggers (e.g., "send email on assignment") – these are handled by a separate eventing system, not this tool.
- Any user interface changes (the API/CLI only; UI teams can build on top).
- Agent lifecycle management (onboarding, deactivation) – the system must already support agent entities.
- Conflict resolution policies beyond simple overwrite (no merge, no priority-based reassignment).

## Requirements

_Owned by the business-analyst._

### REQ-1: API Endpoint — Assign Agent to Task Role

| Field         | Detail |
|---------------|--------|
| **Priority**  | Must-have (P0) |
| **Source**    | Functional Requirement 1 |
| **AC mapping**| All acceptance criteria |

**Description:** Expose a single `POST` endpoint at `/api/tasks/{taskId}/roles/{roleName}/agent` that accepts an `agentRef` in the JSON request body and assigns that agent to the specified manifest role on the task or epic. The endpoint must run within the existing Hono router on the `kanbanRoutes` mount (or a new `roleAssignmentRoutes` if cleaner), reusing the same `authMiddleware` + `isManager` guard already in use by `/api/kanban`.

**Preconditions:**
- The caller is authenticated (valid session or API token).
- The caller holds the `task.assign` permission (manager role, or an equivalent scope — the existing `isManager` guard satisfies this for the initial release).
- The target task/epic (`taskId`) exists in the caller's tenant.
- The target role (`roleName`) exists in that task's participation manifest.
- The `agentRef` resolves to an active agent record in the same tenant.

**Postconditions:**
- On success (200): the agent is recorded as the assigned participant for the role on the task. The participation manifest's state for that role transitions to `assigned` (if previously `unstaffed` or `pending`). The idempotent case (same agent already assigned) returns 200 with the existing record and no state change.
- On conflict (409): the role is already assigned to a *different* agent and `force` was not requested. The existing assignment is preserved, and the response body describes the current assignee.
- On force-overwrite (200): the conflicting assignment is replaced in a single atomic operation (delete old + insert new, or update in place). The old assignee is displaced; no notification is sent (out of scope).
- On failure (4xx/5xx): no side effects — the task's participation manifest is unchanged.

**Request contract:**

```
POST /api/tasks/{taskId}/roles/{roleName}/agent
Content-Type: application/json
Authorization: Bearer <token>

{
  "agentRef": "<string>"     // required; the agent's stable ref (e.g., cloud agent ref or host id)
}
```

Query parameters:
| Param    | Type    | Required | Default | Description |
|----------|---------|----------|---------|-------------|
| `force`  | boolean | No       | `false` | If `true`, overwrite an existing assignment to a different agent. |

**Response contract — Success (200):**

```json
{
  "assignment": {
    "taskId": 772,
    "roleKey": "business-analyst",
    "agentRef": "agnt_abc123",
    "agentName": "BA Agent v2",
    "assignedAt": "2025-06-25T14:30:00.000Z",
    "replaced": false
  }
}
```

`replaced` is `true` when the request overwrote a prior different assignment (force path); `false` for a fresh assignment or idempotent re-request.

**Response contract — Conflict (409):**

```json
{
  "error": "role 'business-analyst' is already assigned to 'agnt_xyz789'",
  "currentAgentRef": "agnt_xyz789",
  "currentAgentName": "Other Agent"
}
```

**Response contract — Not Found (404):**

```json
{
  "error": "task not found"
}
```
— or —
```json
{
  "error": "role 'nonexistent-role' is not defined for task 772"
}
```

**Response contract — Unprocessable (422):**

```json
{
  "error": "role 'system-coordinator' cannot be directly assigned (system-managed)"
}
```

**Response contract — Bad Request (400):**

```json
{
  "error": "agentRef is required"
}
```
— or —
```json
{
  "error": "agent 'agnt_unknown' not found or inactive"
}
```

**Response contract — Forbidden (403):**

```json
{
  "error": "manager role required"
}
```

---

### REQ-2: Input Validation

| Field         | Detail |
|---------------|--------|
| **Priority**  | Must-have (P0) |
| **Source**    | Functional Requirement 3 |
| **AC mapping**| AC-3, AC-4, AC-5 |

All inputs must be validated server-side before any state change. Validation failures return `400` (malformed input), `404` (entity not found), or `422` (entity found but ineligible) as appropriate.

**Validation rules (applied in order):**

1. **Path-param presence:** `taskId` must be parseable as a positive integer; `roleName` must be a non-empty string. Fail → `400`.
2. **Body presence:** `agentRef` must be present and a non-empty string. Fail → `400`.
3. **Task existence:** `taskId` must resolve to a row in `tasks` within the caller's tenant. Fail → `404` ("task not found").
4. **Manifest role existence:** `roleName` must appear as a `roleKey` in the task's participation manifest (via `TicketParticipantsService`). Fail → `404` ("role 'X' is not defined for task N").
5. **Role assignability:** The role must not be marked as system-managed / non-assignable. Fail → `422` ("role 'X' cannot be directly assigned").
6. **Agent existence and liveness:** `agentRef` must resolve to an active agent in the tenant (cloud agent with `status = 'active'` or a host agent with `active = true`, depending on agent type). Fail → `400` ("agent 'X' not found or inactive").
7. **Conflict check:** If the role already has an assigned agent that differs from the requested `agentRef`, and `force` is not `true`, fail → `409`. Otherwise proceed.

---

### REQ-3: Idempotency

| Field         | Detail |
|---------------|--------|
| **Priority**  | Must-have (P0) |
| **Source**    | Functional Requirement 1 (idempotency clause) |
| **AC mapping**| AC-2 |

Assigning the same `agentRef` to the same `roleName` on the same `taskId` more than once must produce exactly the same result as the first call: `200 OK` with the assignment record, no duplicate rows, no side effects, no audit spam (a single audit entry for the first creation; subsequent idempotent calls may log at DEBUG/TRACE level only).

**Implementation guidance:** The handler queries the existing assignment before inserting. If the current assignee matches, short-circuit with `200` and the existing record. Do not bump `updatedAt` or fire a second activity-log entry.

---

### REQ-4: Force-Overwrite Conflict Resolution

| Field         | Detail |
|---------------|--------|
| **Priority**  | Should-have (P1) |
| **Source**    | Functional Requirement 1, CLI `--force` flag |
| **AC mapping**| AC-3 |

When `?force=true` (API) or `--force` (CLI) is set and the role is already assigned to a *different* agent, the existing assignment is atomically replaced. The response returns `200` with `replaced: true`. No merge or priority-based logic is applied — it is a pure overwrite.

**Atomicity:** The replace must execute within a single database transaction (delete old row + insert new row, or a single `UPSERT`/`UPDATE`). Partial failure (old row deleted, new row not inserted) must not leave the role unassigned.

---

### REQ-5: CLI Command

| Field         | Detail |
|---------------|--------|
| **Priority**  | Should-have (P1) |
| **Source**    | Functional Requirement 2 |
| **AC mapping**| AC-9 |

A CLI subcommand mirrors the API exactly. It calls the same endpoint and renders the result in a human-readable format.

**Interface:**
```
builderforce assign-agent --task <taskId> --role <roleName> --agent <agentRef> [--force]
```

**Output (success):**
```
✓ Agent 'BA Agent v2' (agnt_abc123) assigned to role 'business-analyst' on task #772.
```

**Output (conflict, no --force):**
```
✗ Role 'business-analyst' on task #772 is already assigned to 'Other Agent' (agnt_xyz789).
  Use --force to overwrite.
```

**Output (error):**
```
✗ Error: task not found
```

**Requirements:**
- The CLI must use the same auth context as other `builderforce` commands (read from env/config).
- Exit code `0` on success; non-zero on any error.
- `--force` is a boolean flag, off by default.
- The command must be a single round-trip (no interactive prompts, no multi-step wizard).

---

### REQ-6: Audit Trail

| Field         | Detail |
|---------------|--------|
| **Priority**  | Must-have (P0) |
| **Source**    | Functional Requirement 4 |
| **AC mapping**| AC-8 |

Every non-idempotent assignment (fresh creation or force-overwrite) must write an entry to the activity log via the existing `recordActivity` infrastructure.

**Logged fields:**
| Field        | Value |
|--------------|-------|
| `tenantId`   | Caller's tenant |
| `projectId`  | Derived from the task's project |
| `actor`      | Resolved from the authenticated caller (human or agent) |
| `verb`       | `ticket.role.assigned` |
| `targetType` | `task` |
| `targetId`   | `String(taskId)` |
| `targetLabel`| `#N` |
| `summary`    | `Assigned <agentName> to <roleLabel> on task #N` (≤ 300 chars) |
| `metadata`   | `{ roleKey, agentRef, agentName, force: bool, replaced: bool }` |

Idempotent re-requests (same agent to same role) must NOT produce an activity entry at the INFO/WARN level. A DEBUG-level log line in server logs is acceptable but not required.

---

### REQ-7: Authentication & Authorization

| Field         | Detail |
|---------------|--------|
| **Priority**  | Must-have (P0) |
| **Source**    | Functional Requirement 5 |
| **AC mapping**| AC-7 |

- The endpoint must sit behind `authMiddleware` (the same Hono middleware used by existing kanban routes).
- Only callers with the manager role (`isManager`) may invoke the endpoint. Unauthenticated requests → `401`; authenticated but unauthorized → `403`.
- The tenant is scoped from the auth token — cross-tenant access is impossible (the task lookup is tenant-scoped).

---

### REQ-8: Non-Functional Requirements

| ID    | Category        | Requirement |
|-------|-----------------|-------------|
| NFR-1 | **Latency**     | p95 response time ≤ 200 ms under normal load (single-assignment path; excludes auth). |
| NFR-2 | **Availability** | Inherits the API service's availability SLA. No new stateful dependency is introduced; the endpoint is stateless aside from the existing DB. |
| NFR-3 | **Throughput**   | Must sustain ≥ 50 assignments/second without degradation (CI/CD dispatch bursts). |
| NFR-4 | **Error handling** | All errors return structured JSON with an `error` string field. No stack traces or internal detail leak to the client in production. |
| NFR-5 | **Backwards compatibility** | The new route must not break or shadow any existing route. Path `/api/tasks/{taskId}/roles/{roleName}/agent` does not collide with any documented route. |
| NFR-6 | **Observability** | Assignment operations must emit structured logs at INFO level (success) and WARN/ERROR level (failures) with `taskId`, `roleKey`, `agentRef`, and `outcome` fields for log aggregation. |

---

### Traceability Matrix

| Requirement | AC-1 | AC-2 | AC-3 | AC-4 | AC-5 | AC-6 | AC-7 | AC-8 | AC-9 |
|-------------|------|------|------|------|------|------|------|------|------|
| REQ-1 (API) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| REQ-2 (Validation) | — | — | ✓ | ✓ | ✓ | — | — | — | — |
| REQ-3 (Idempotency) | — | ✓ | — | — | — | — | — | — | — |
| REQ-4 (Force) | — | — | ✓ | — | — | — | — | — | — |
| REQ-5 (CLI) | — | — | — | — | — | — | — | — | ✓ |
| REQ-6 (Audit) | — | — | — | — | — | — | — | ✓ | — |
| REQ-7 (Auth) | — | — | — | — | — | — | ✓ | — | — |

---

### Dependencies & Pre-existing Infrastructure

The following existing services and tables are relied upon (no new schema migrations are in scope for this feature):

| Dependency | Used for |
|------------|----------|
| `TicketParticipantsService` | Reading the task's participation manifest to validate `roleName`. |
| `kanbanRoutes` (`/api/kanban`) | Mount point; the new route may be added here or as a sibling router. |
| `authMiddleware` + `isManager` | Authentication and authorization. |
| `recordActivity` | Audit trail writes. |
| `tasks` table | Task existence check. |
| `ide_agents` / agent repository | Agent existence and liveness check. |

---

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Race condition on force-overwrite (two callers force-assign simultaneously) | Low | Medium | Use a DB transaction with row-level locking (`SELECT ... FOR UPDATE`) on the existing assignment row before replacing. |
| Agent is deactivated between validation and insert | Low | Low | Acceptable — the assignment still succeeds; stale assignments are cleaned up by the existing manager sweep. |
| CLI auth token management friction | Medium | Low | Document the `BUILDERFORCE_TOKEN` env var; reuse the same auth helper as other CLI commands. |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
