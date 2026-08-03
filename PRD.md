> **PRD** — drafted by Ada (Sr. Product Mgr) · task #586
> **Requirements** — authored by Business Analyst · task #586
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: GAP-G2 Sanity-of-Life Compliance Closure

**Document Owner:** Product Architecture
**Status:** WIP
**Task Reference:** #144
**Conclusion:** Sanity-of-Life Compliance Determined

---

## 1. Problem & Goal

### Problem
Workstream GAP-G2 represented an open compliance risk and operational debt. The lack of a definitive determination regarding its sanity-of-life compliance status caused ambiguity for downstream teams, preventing architectural alignment and potentially impacting audit readiness.

### Goal
Formally close GAP-G2 by recording the determined sanity-of-life compliance conclusion within the workstream tracker. Ensure the closure status, rationale, and any resulting compliance guardrails are clear and accessible to all stakeholders, eliminating the identified gap.

---

## 2. Target Users / ICP Roles
- **Compliance Officers:** Require evidence of gap resolution for audit trails.
- **Product Architects:** Need a definitive state to inform system design and dependencies.
- **Engineering Leads:** Must understand compliance boundaries to prevent regressions during implementation.

---

## 3. Scope

- Update the workstream tracker item for GAP-G2 to reflect `Closed` status.
- Attach or link the final sanity-of-life compliance determination rationale.
- Propagate the compliance outcome to the central compliance register (if automatically linked).
- Ensure no functional code changes are implemented solely to satisfy this closure, unless explicitly identified as remediation in the determination.

---

## 4. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | Workstream tracker must display GAP-G2 status as `Closed` with an immutable timestamp. | P0 |
| FR2 | The `Conclusion` field must contain the determined outcome ("Sanity-of-Life Compliance") and a summary of the rationale. | P0 |
| FR3 | System must prevent re-opening GAP-G2 without a documented waiver or exception process. | P1 |
| FR4 | Downstream compliance dashboards must ingest the closure event and reflect a clean state for the GAP-G2 identifier. | P1 |

---

## 5. Acceptance Criteria

- **AC1:** Task #144 in the workstream tracker shows `Closed` status and is read-only for all roles except admins.
- **AC2:** The resolution comment includes the exact phrase "Sanity-of-Life Compliance" along with a link to the signed-off determination artfact.
- **AC3:** A query of the compliance register for GAP-G2 returns `Resolved` status within 1 hour of the tracker update.
- **AC4:** No open sub-tasks or dependents are blocked by the GAP-G2 closure.

---

## 6. Out of Scope

- Remediation work required to *achieve* sanity-of-life compliance (already completed or waived prior to this determination).
- Broad retrospective changes to other GAP items not directly related to GAP-G2.
- User-facing product changes, unless those changes were explicitly part of a pre-existing remediation plan executed before closure.

---

## Requirements

### BR-1: GAP-G2 Workstream Closure — Data Integrity

**Priority:** P0 (Critical)

The closure of GAP-G2 task #144 in the workstream tracker must be performed as a single atomic operation that transitions the task status to `done` (or an equivalent terminal `Closed` state) and simultaneously records:

| Field | Value / Constraint |
|-------|--------------------|
| `status` | `done` (terminal; maps to "Closed" in the workstream tracker display) |
| `updatedAt` | Server-issued timestamp at the moment of closure (immutable once written) |
| `conclusion` | Literal string: `"Sanity-of-Life Compliance — determined via GAP-G2 Secret Lifecycle Validation (task #575). All lifecycle checks (creation, rotation, revocation, plaintext scans, expiry enforcement) returned a pass or waived verdict. No blocking P1 findings remain. See signed determination artefact: builderforce/task-575 / PR #306."` |
| `closedBy` | Reference to the agent or user identity executing the closure |

**Rationale:** FR1 and FR2 require the tracker to display `Closed` status with an immutable timestamp and a `Conclusion` field containing the determined outcome. A single atomic write prevents incomplete states.

### BR-2: Immutable Closure Guard

**Priority:** P1 (High)

Once GAP-G2 task #144 reaches its terminal `done` status:
- The `status` field must be read-only for all non-admin roles (including agents).
- Any attempt to transition the task from `done` back to an active status (`ready`, `in_progress`, `backlog`) must be rejected unless the caller presents a documented waiver or exception reference. The rejection response must include a message indicating the waiver requirement.
- Admin-role users may override this guard by providing a `waiverId` or `exceptionRef` that links to a documented exception process.

**Rationale:** FR3 requires that GAP-G2 cannot be re-opened without a waiver or exception process. This BR formalises the guard as both a role-based access control and a required reference check.

### BR-3: Compliance Register Propagation

**Priority:** P1 (High)

Upon successful closure of task #144:
- A closure event must be emitted to the compliance register, keyed by the GAP-G2 identifier.
- The compliance register entry for GAP-G2 must transition to `Resolved` status within a **1-hour SLA** from the tracker closure event timestamp.
- If the compliance register is unreachable, the system must retry with exponential backoff (initial: 30 seconds, maximum: 15 minutes) and log each attempt. After 1 hour of failed attempts, the closure must remain valid in the tracker and an alert must be raised to the platform operations channel.
- Downstream dashboards that source from the compliance register must reflect the `Resolved` state on their next refresh cycle (no additional action required beyond the register update).

**Rationale:** FR4 and AC3 require the compliance register to ingest the closure and reflect `Resolved` status within 1 hour. This BR specifies the propagation mechanism, retry policy, and failure mode.

### BR-4: Dependency Integrity Check (Pre-Closure)

**Priority:** P0 (Critical)

Before task #144 can be closed, a dependency integrity check must execute:

1. Query all child tasks of Epic #144.
2. Verify that **every child task** has a status of `done` (terminal) — no child may be `in_progress`, `ready`, `backlog`, or any non-terminal state.
3. If any child task is non-terminal, the closure must be **blocked** and the caller must receive a response listing each blocking child by ID, title, and current status.
4. The check must execute within the same transaction as the closure so that a child completing concurrently does not produce a race condition.

**Rationale:** AC4 requires no open sub-tasks or dependents are blocked by the GAP-G2 closure. Task #575 (GAP-G2 validation) is currently `done`, satisfying this check for the immediate child. This BR ensures any future children are also accounted for before closure.

### BR-5: Closure Event Audit Trail

**Priority:** P2 (Medium)

Every GAP-G2 closure event (including the initial closure and any subsequent admin re-open/re-close with a waiver) must produce an immutable audit log entry containing:

| Field | Description |
|-------|-------------|
| `eventType` | `gap_closure` |
| `gapId` | `GAP-G2` |
| `taskId` | `144` |
| `action` | `closed` or `reopened` |
| `actorRef` | Identity of the agent or user who performed the action |
| `timestamp` | Server-issued timestamp |
| `waiverId` | Present only if the action was performed with a waiver/exception |
| `rationale` | Summary of the reason for the action |

This log must be queryable by compliance officers through the existing audit interface and preserved for the duration of the workspace retention policy.

**Rationale:** While not explicitly stated in the FR table, an audit trail is a baseline compliance expectation for any gap closure, particularly one designated "sanity-of-life." This BR ensures the closure is auditable.

### BR-6: No Functional Side-Effects

**Priority:** P0 (Critical)

The closure of GAP-G2 must **not** trigger any of the following side-effects:
- No repository code changes, schema migrations, or configuration modifications.
- No automated agent dispatch, deployment, or infrastructure provisioning.
- No changes to the state of non-GAP-G2 tasks, projects, or resources.
- No modification to the secret lifecycle validation results recorded by task #575.

The closure is a **declarative status change only**. The validation work (task #575) and its evidence (PR #306) are already complete and recorded.

**Rationale:** The PRD explicitly states that no functional code changes are implemented solely to satisfy this closure. This BR makes that constraint operational and testable.

---

## Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-1 | The closure operation must complete in under 2 seconds (p95) under normal load. | P2 |
| NFR-2 | The audit log for GAP-G2 must be preserved for a minimum of 7 years to satisfy SOC 2 retention requirements. | P1 |
| NFR-3 | The compliance register propagation must succeed with 99.9% reliability over a rolling 30-day window. | P1 |

---

## Traceability Matrix

| Business Req | Functional Req | Acceptance Criteria |
|-------------|---------------|---------------------|
| BR-1 | FR1, FR2 | AC1, AC2 |
| BR-2 | FR3 | AC1 |
| BR-3 | FR4 | AC3 |
| BR-4 | — (derived) | AC4 |
| BR-5 | — (derived) | — (compliance baseline) |
| BR-6 | — (scope guard) | — (out-of-scope enforcement) |

---

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
