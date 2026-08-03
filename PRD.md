> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1531
> _Each agent that updates this PRD signs its change below._
> 
> **Requirements** — authored by Kevin (Business Analyst) · 2026-08-03
> 
> **Signature:** Kevin (Business Analyst) · 2026-08-03

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
   - The event must appear in the task's history timeline with a distinct flag indicating it was applied retroactively.

4. **Board State Consistency**
   - After the retroactive signoff is applied, the kanban board state for task #579 must reflect the fulfilled accountability slot identically to a normally recorded signoff.
   - Any downstream DoD checks or automation triggered by `business-analyst:approved in backlog` must be equivalently satisfied.

## Acceptance Criteria
1. **Happy Path – Retroactive Signoff Applied**
   - *Given* an admin user authenticated with `ROLE_BOARD_ADMIN` and the commit `abc123` on `builderforce/task-579` containing the completed Requirements section
   - *When* the admin calls the retroactive-signoff operation for task #579 with `roleKey=business-analyst`, `laneKey=backlog`, `verdict=approved`, contributor=Kevin, evidence=commit `abc123`
   - *Then* the system returns HTTP 201, the task's business-analyst slot in backlog shows `approved`, the event is logged with retroactive metadata, and any gating rules for `business-analyst:approved` are evaluated.

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

> **Author:** Kevin (Business Analyst) · task #1531 · 2026-08-03
> _Traceability: each requirement maps to the Functional Requirements (FR-1…FR-4) and Acceptance Criteria (AC-1…AC-4) in the sections above._

### REQ-1 — Retroactive Signoff API

**Traceability:** FR-1, AC-1, AC-2, AC-3

1. **REQ-1.1 — Endpoint.** The platform shall expose an HTTP endpoint `POST /api/kanban/tasks/:taskId/signoff/retroactive` that accepts a JSON payload enabling an authorized caller to record a signoff verdict on behalf of another contributor whose original auth token is no longer valid.

2. **REQ-1.2 — Request Payload Shape.** The request body shall accept the following fields, with the given constraints:

   | Field | Type | Required | Description |
   |---|---|---|---|
   | `roleKey` | string (enum) | Yes | The role being signed off, e.g. `business-analyst`. Must match an existing role key in the kanban participation manifest. |
   | `laneKey` | string | Yes | The lane in which the signoff is recorded, e.g. `backlog`. Must match a lane gating rule for the given role. |
   | `verdict` | string (enum) | Yes | One of `approved`, `changes_requested`, `waived`, `delegated`. |
   | `contributorUserId` | string (UUID) | Yes | The user ID of the original contributor whose delivered work is being signed off. |
   | `evidence` | object | Yes | An object containing at minimum `executionId` (number) and `prUrl` (string URI). May also include `diffFiles` (string array) and `summary` (string). |
   | `reason` | string | Yes | A human-readable justification for the retroactive application (minimum 20 characters, maximum 500). |
   | `memberRef` | string | No | Agent ref if the original contributor was an agent. Mutually aware with `contributorUserId` — at least one must be present. |
   | `memberKind` | string (enum) | No | `human` or `agent`. Defaults to `human` if `contributorUserId` is supplied, `agent` if `memberRef` is supplied. |

3. **REQ-1.3 — Response (Success).** On success, the endpoint shall return HTTP 201 with a JSON body containing:

   ```json
   {
     "signoffId": "<uuid>",
     "taskId": 579,
     "roleKey": "business-analyst",
     "laneKey": "backlog",
     "verdict": "approved",
     "appliedBy": "<admin-user-id>",
     "appliedAt": "<ISO-8601 timestamp>",
     "retroactive": true,
     "duplicate": false
   }
   ```

4. **REQ-1.4 — Response (Idempotent Replay).** If a signoff record with the same `(taskId, roleKey, laneKey)` and verdict `approved` already exists, the endpoint shall return HTTP 200 with the existing signoff record and `"duplicate": true`. The response body shall be otherwise identical to a new creation response.

5. **REQ-1.5 — Response (Idempotent Conflict).** If a signoff record already exists with a *different* verdict for the same `(taskId, roleKey, laneKey)`, the endpoint shall return HTTP 409 with a body containing:

   ```json
   {
     "error": "conflict",
     "message": "A signoff already exists for this role/lane with a different verdict.",
     "existingVerdict": "<existing-verdict>",
     "existingSignoffId": "<uuid>"
   }
   ```

6. **REQ-1.6 — Authentication.** The endpoint shall require a valid Bearer token in the `Authorization` header. Requests without a valid token shall return HTTP 401. The caller's token must NOT be the expired/original contributor's token — the endpoint is designed for a different, currently-valid caller.

### REQ-2 — Authorization (RBAC)

**Traceability:** FR-2, AC-3

1. **REQ-2.1 — Required Permission.** The caller must possess the permission `kanban:signoff:retroactive` (or a parent role such as `ROLE_BOARD_ADMIN` that grants it). The platform's existing RBAC middleware shall enforce this check before the handler executes.

2. **REQ-2.2 — Forbidden Response.** If the caller's token is valid but lacks the required permission, the endpoint shall return HTTP 403 with a body:

   ```json
   {
     "error": "forbidden",
     "message": "The caller lacks the kanban:signoff:retroactive permission required to apply a retroactive signoff."
   }
   ```

3. **REQ-2.3 — Admin Audit.** Every retroactive signoff shall log the `appliedBy` user ID (the authenticated caller, not the original contributor) in both the signoff record and the task timeline event. This ensures a human or service-account trace for every override.

4. **REQ-2.4 — Permission Scope.** The `kanban:signoff:retroactive` permission shall be project-scoped — an admin for project A cannot retroactively sign off a task in project B unless they hold the permission in both projects. The handler shall verify that the caller's permission scope includes the project that owns `taskId`.

### REQ-3 — Audit Trail & Persistence

**Traceability:** FR-3, AC-1

1. **REQ-3.1 — Signoff Record Persistence.** The retroactive signoff shall be persisted as a row in the existing `kanban_signoffs` table (or equivalent). The row shall include a boolean column `retroactive` set to `true` and a text column `retroactive_reason` storing the caller-supplied reason.

2. **REQ-3.2 — Timeline Event.** The system shall insert a timeline event into the `task_timeline` (or equivalent) table with:

   - `eventType`: `signoff.retroactive`
   - `actorUserId`: the admin caller's user ID
   - `metadata`: a JSON blob containing `{ roleKey, laneKey, verdict, originalContributorUserId, evidence, reason, signoffId }`
   - `retroactive`: `true` (boolean flag)

   The timeline event shall be surfaced in the task's history feed with a distinct visual indicator (e.g. a ⚠️ "Retroactive" badge or icon) so that reviewers can distinguish it from a normally recorded signoff.

3. **REQ-3.3 — Immutability.** Once persisted, a retroactive signoff record shall be immutable. No endpoint shall update or delete an existing signoff through the retroactive API. (Correction of a retroactively applied signoff requires a separate, purpose-built admin tool — out of scope for this PRD.)

4. **REQ-3.4 — Accountability Report Integration.** The `GET /api/kanban/tasks/:taskId/accountability` endpoint shall include retroactive signoffs identically to normal signoffs, with an additional boolean field `retroactive` on each signoff entry. The accountability report's `%-complete` calculation shall treat a retroactive signoff as equivalent to a normal one.

### REQ-4 — Board State Consistency

**Traceability:** FR-4, AC-1, AC-4

1. **REQ-4.1 — Participation Manifest Update.** After a retroactive signoff is recorded, the kanban participation manifest for the task shall update the state of the `(roleKey, laneKey)` slot to match the verdict (e.g. `completed` for `approved`, `changes_requested` for `changes_requested`). This is identical behaviour to a normally recorded signoff.

2. **REQ-4.2 — Lane Gating Re-evaluation.** After the signoff is persisted and the manifest updated, the system shall trigger a re-evaluation of any DoD gating rules that consume the `(roleKey, laneKey, verdict)` tuple. Specifically for task #579: the `business-analyst:approved@backlog` gate shall be marked satisfied (not retroactively — the gate result is the same as if the signoff had been normal).

3. **REQ-4.3 — Lane Transition Non-Interference.** A retroactive `backlog:approved` shall NOT block or interfere with a subsequent `in_progress:approved` or `review:approved` signoff for the same `roleKey` in a different lane. Each `(roleKey, laneKey)` pair is independently evaluated.

4. **REQ-4.4 — Coordinator Re-dispatch.** After the retroactive signoff resolves a previously unfulfilled accountability slot, the task coordinator shall be notified (or re-triggered) to re-evaluate whether the task can advance. If the retroactive signoff was the last outstanding gate, the coordinator shall be permitted to move the task to the next lane.

### REQ-5 — Error Handling & Edge Cases

**Traceability:** AC-1, AC-2, AC-3

1. **REQ-5.1 — Invalid Task.** If `taskId` does not exist or is archived, return HTTP 404:

   ```json
   { "error": "not_found", "message": "Task <id> not found." }
   ```

2. **REQ-5.2 — Invalid Role/Lane.** If the `roleKey` is not in the task's participation manifest for the given `laneKey`, return HTTP 422:

   ```json
   {
     "error": "unprocessable",
     "message": "Role 'business-analyst' is not required for lane 'backlog' on this task.",
     "availableRoles": ["architect", "developer", "code-reviewer"]
   }
   ```

3. **REQ-5.3 — Invalid Verdict.** If `verdict` is not one of the enumerated values, return HTTP 422:

   ```json
   { "error": "unprocessable", "message": "Invalid verdict 'accepted'. Must be one of: approved, changes_requested, waived, delegated." }
   ```

4. **REQ-5.4 — Missing Evidence.** If the `evidence` object is absent or does not contain at minimum a valid `executionId` AND `prUrl`, return HTTP 422:

   ```json
   { "error": "unprocessable", "message": "Evidence must include at least executionId and prUrl." }
   ```

5. **REQ-5.5 — Invalid Reason.** If `reason` is fewer than 20 characters or exceeds 500 characters, return HTTP 422:

   ```json
   { "error": "unprocessable", "message": "Reason must be between 20 and 500 characters." }
   ```

6. **REQ-5.6 — Validation Order.** Validation shall execute in the following order: authentication (401) → authorization (403) → task existence (404) → payload validation (422) → idempotency check (200/409) → persistence (201). This ensures that callers without permission receive no information about task existence.

### REQ-6 — Observability

**Traceability:** FR-1, AC-1

1. **REQ-6.1 — Structured Logging.** Every invocation of the retroactive signoff endpoint shall emit a structured log entry at `info` level on success, `warn` on idempotent replay or authz failure, and `error` on internal failures. The log entry shall include: `taskId`, `roleKey`, `laneKey`, `verdict`, `appliedBy`, `outcome` (`created` | `duplicate` | `conflict` | `forbidden` | `error`), and `durationMs`.

2. **REQ-6.2 — Metric Emission.** The endpoint shall increment a counter metric `kanban_signoff_retroactive_total` with labels `{ outcome, roleKey, laneKey }`. This allows operators to monitor the frequency of retroactive applications and detect abuse.

3. **REQ-6.3 — Alert Threshold.** If more than 5 retroactive signoffs are recorded across the workspace within a 24-hour rolling window, the system should emit a warning-level log and optionally notify the workspace admin. (This is a soft guardrail, not a hard limit — it does not reject requests.)

### REQ-7 — Task #579 Specific Application

**Traceability:** Scope, FR-1, AC-1

1. **REQ-7.1 — Concrete Payload.** The initial application of this feature shall target task #579 with the following concrete payload:

   ```json
   {
     "roleKey": "business-analyst",
     "laneKey": "backlog",
     "verdict": "approved",
     "contributorUserId": "Kevin",
     "evidence": {
       "executionId": 24495,
       "prUrl": "https://github.com/SeanHogg/Builderforce.ai/pull/477",
       "diffFiles": ["PRD.md"],
       "summary": "Requirements section of PRD.md for task #579 (GAP ID System). 41 requirements across 7 categories authored in execution #24495."
     },
     "reason": "Retroactive application due to auth failure during original attempt. Deliverable verified in PR #477, execution #24495 on branch builderforce/task-579. Original 4 signoff attempts returned HTTP 401 (token expired)."
   }
   ```

2. **REQ-7.2 — Verification Before Application.** Before the retroactive signoff is applied, the handler shall verify that the referenced evidence exists:
   - Execution #24495 exists and is `completed`
   - PR #477 exists and references task #579
   - The PRD.md in that PR contains the Requirements section

   If any verification fails, the endpoint shall return HTTP 422 with a specific message naming which piece of evidence could not be verified.

3. **REQ-7.3 — One-Shot Scope.** This feature is scoped to resolve task #579. The retroactive endpoint shall remain available after this application for future use by admins, but no bulk or automated application to other tasks is in scope.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
