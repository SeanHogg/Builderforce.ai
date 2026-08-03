> **PRD** — drafted by Ada (Sr. Product Mgr) · task #829
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Auto-resolve Owner Role from Epic Assignee

## Problem & Goal
**Problem:** When an issue is created under an epic, the Owner role does not automatically inherit the epic's assignee. This requires manual assignment, introduces human error, and causes ownership misalignment across the epic's work breakdown.

**Goal:** Automatically resolve the `Owner` role for an issue to the epic's assignee, ensuring consistent ownership propagation. The immediate verification target is epic assignee **Ada** (user ID `fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`).

## Target Users / ICP Roles
- **Project Managers / Team Leads** who define epics and expect consistent ownership without manual per-issue assignment.
- **Developers & Product Owners** who create, triage, or pick up issues and rely on accurate Owner metadata.
- **System Administrators** who configure automation rules and audit role assignments.

## Scope
- **In scope:**  
  Automatic resolution of the `Owner` field on issue creation and epic-link changes, based solely on the parent epic's current assignee.  
  Verification that the rule correctly fires for Ada (`fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`).  
  Handling of epic assignee updates (proactive re-resolution for all un-overridden child issues).  
  Proper behaviour when the epic has no assignee.

## Functional Requirements
1. **Issue creation / linkage**  
   When an issue is associated with an epic that has an assignee, the issue's `Owner` field must be set to that assignee without user intervention.

2. **Epic assignee change**  
   If the epic's assignee changes, all open issues belonging to that epic must have their `Owner` field updated to the new assignee, **unless** a user has manually overridden the `Owner` on an individual issue (explicit override preserves manual value).

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
   **Then** the issue's `Owner` field is automatically set to Ada, visible immediately upon creation.

2. **AC2 – Epic assignee change propagates**  
   **Given** an epic with assignee Ada and two open child issues (both have `Owner` = Ada, neither has a manual override)  
   **When** the epic assignee is changed to another user (e.g., `Bob`)  
   **Then** both child issues' `Owner` fields are updated to `Bob` within 5 seconds.

3. **AC3 – Manual override persists**  
   **Given** a child issue whose `Owner` was manually set to `Charlie` (overriding the epic's Ada)  
   **When** the epic assignee changes from Ada to `Dana`  
   **Then** the issue's `Owner` remains `Charlie` and is **not** overwritten.

4. **AC4 – No assignee on epic**  
   **Given** an epic with **no** assignee  
   **When** a new issue is created under that epic  
   **Then** the issue's `Owner` field remains blank.

5. **AC5 – Audit log capture**  
   **Given** any automatic `Owner` assignment or update  
   **When** the change occurs  
   **Then** the issue's activity history contains a system entry describing the change (e.g., "Owner automatically set from epic assignee").

## Out of Scope
- Automation of roles other than `Owner` (e.g., Reviewer, Approver, QA).
- Bulk backfill of `Owner` on existing issues that pre-date this automation.
- Resolution across multi-level hierarchies (e.g., epic → story → sub-task); only direct epic-to-issue relationship is covered.
- UI configuration or user preferences to opt out of auto-assignment (default behaviour applies globally).
- Custom fallback assignment logic when an epic has no assignee (e.g., defaulting to the project lead).

## Requirements

> _Authored by the Business Analyst — signed: [BA]_

### RQ1: System model mapping

In the BuilderForce codebase, the "Owner" of a ticket is represented by two fields that must be kept aligned:

| Concept | Field | Location |
|---|---|---|
| **Ticket human assignee** | `assignedUserId` (varchar, FK → `users.id`) | `tasks` table column; `Task.assignedUserId` domain property |
| **Product Owner accountability role** | `product-owner` role key in the ticket participation manifest | `ticket_participants` rows (roleKey='product-owner', responsibility='owner') |

Auto-resolution applies to **both** fields: when the epic assignee propagates, child tickets get `assignedUserId` updated AND the `product-owner` manifest slot re-resolved. These two writes always happen together (one atomic implementation) so the board chip, the accountability report, and every consumer that reads one or the other see the same owner.

### RQ2: Propagation trigger points

The epic → child owner propagation fires from exactly TWO code paths:

**RQ2a — Child creation (FR1 / AC1)**  
`TaskService.createTask()` at `api/src/application/task/TaskService.ts`. When a `CreateTaskDto` carries a `parentTaskId` and the caller did NOT supply `assignedUserId`:
1. Look up the parent epic (`this.tasks.findById(parentTaskId)`).
2. If the parent's `taskType === 'epic'` and `parent.assignedUserId !== null`, set the child's `assignedUserId = parent.assignedUserId`.
3. If the parent epic has no assignee, leave `assignedUserId` null (AC4).
4. If the caller DID supply `assignedUserId` explicitly, that value wins (AC3 manual-override signal — see RQ3).
5. After persist, derive the ticket participation manifest (`TicketParticipantsService.deriveManifest`) so the `product-owner` slot resolves to the same user.

**RQ2b — Epic assignee change (FR2 / AC2)**  
`TaskService.updateTask()` at `api/src/application/task/TaskService.ts`. When an epic's `assignedUserId` changes:
1. Detect the transition: `wasAssignedUserId !== updated.assignedUserId` AND `task.taskType === 'epic'`.
2. Query all direct children: `this.tasks.findChildren(task.id)` — these are rows with `parentTaskId = epic.id`.
3. For each child that does NOT carry a manual override (see RQ3): update `assignedUserId` to the new value.
4. For each child: record an activity log entry (see RQ5).
5. This is a synchronous operation within the same request — child count is bounded by `decomposeEpic`'s fan-out, and the PRD's 5-second window is the SLA.

**Decomposition fan-out** (`TaskService.decomposeEpic()`) is the existing path that already creates children under an epic. Its `recommendChildAssignee` hook handles agent-capability-based assignment. The BA notes that `decomposeEpic` already receives `task.projectId` and knows `task.assignedUserId` — the epic's human assignee IS available at the fan-out site and should be passed to children that are not explicitly assigned to an agent. This is a NATURAL EXTENSION of RQ2a but is noted as a design decision for the architect: fan-out children can inherit the epic assignee when no agent/specific human is named in the child plan.

### RQ3: Manual override detection (AC3)

A manual override is defined as: **a child task's `assignedUserId` was set to a value that differs from the parent epic's `assignedUserId` at the time the child was created or last auto-propagated.**

Implementation options (architect to choose):
- **Option A — Explicit column:** Add a boolean column `owner_override` to `tasks` (default `false`). Set to `true` when a human explicitly PATCHes `assignedUserId` on a child task to a value different from what auto-resolution would produce. The propagation loop in RQ2b skips any child with `owner_override = true`.
- **Option B — Comparison at propagation time:** At propagation time, compare `child.assignedUserId` against a stored "last auto-resolved owner." Requires an additional column `auto_resolved_owner` (nullable varchar) on `tasks`. The propagation skip condition is `child.auto_resolved_owner !== null && child.assignedUserId !== child.auto_resolved_owner` (i.e., someone changed it since the last auto-set).

Option A is recommended — it is simpler to query (single boolean), maps cleanly to the `UpdateTaskDto` surface (a board PATCH that sets `assignedUserId` can also set `ownerOverride: true`), and does not require storing the auto-resolved value as separate state. The `owner_override` flag is reset to `false` whenever auto-propagation succeeds (the owner was re-synced to the epic), and is never auto-set — only a explicit human edit flips it to `true`.

### RQ4: product-owner role resolution

The ticket participation manifest (`ticket_participants` rows) already resolves role assignees from `projectRoleAssignments` (pinned per-project role staffing). To keep the `product-owner` slot aligned with the epic-auto-resolved `assignedUserId`:

1. After any auto-propagation (RQ2a or RQ2b), call `TicketParticipantsService.deriveManifest()` — this idempotent method re-resolves each template-sourced slot's assignee.
2. For the `product-owner` role specifically, the `resolveAssignee` method in `ticketParticipants.ts` should check whether the ticket has an auto-resolved `assignedUserId` from an epic parent BEFORE falling through to `projectRoleAssignments`. That way the epic assignee takes priority over the project-level role pin for child tickets.
3. This lookup does NOT require a schema change — `ticket_participants` already stores `assigneeKind='human'`, `assigneeRef=<userId>`, and `assigneeName`. The resolution logic just needs a new priority tier: epic-derived owner > explicit project role pin > first role-capable agent.

**No backfill:** `deriveManifest` only derives template-sourced rows. Tickets whose manifest was already derived will get the `product-owner` slot re-resolved on the NEXT manifest derivation — which the propagation loop triggers explicitly.

### RQ5: Audit trail (AC5)

Use the existing `recordActivity()` in `api/src/application/activity/activityLog.ts`:

- **Actor:** `SYSTEM_ACTOR` (`{ type: 'system', ref: null, name: 'System' }`) — this is an automated rule, not a user action.
- **Verb:** `'task.owner_auto_resolved'` (new verb — consistent with the `'task.created'`, `'task.assigned'` pattern).
- **Target:** The child task that received the auto-assignment.
- **Summary:** `"Owner automatically set to {userName} ({userId}) from epic {epicKey} assignee"` or `"Owner cleared — parent epic {epicKey} has no assignee"`.
- **Metadata:** `{ epicTaskId, epicKey, previousOwner: userId|null, newOwner: userId|null, trigger: 'creation'|'epic_assignee_change' }`.

For the bulk propagation case (RQ2b, N children updated), emit one activity row per child — this matches the existing per-task activity granularity and keeps the child's own timeline complete.

### RQ6: Verification for Ada (FR6)

The specific user `fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6` (Ada) must be explicitly listed in a test case. No special-casing in production logic — this is a test fixture requirement:

1. Test: Create an epic assigned to `fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`.
2. Test: Create a child task with `parentTaskId` pointing to that epic, no explicit `assignedUserId`.
3. Assert: `child.assignedUserId === 'fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6'`.

### RQ7: Database changes

Summary of new/changed schema artefacts (exact migration number TBD by developer against the migration directory):

| Change | Table | Column / Index | Notes |
|---|---|---|---|
| ADD | `tasks` | `owner_override` BOOLEAN NOT NULL DEFAULT false | Tracks manual override (RQ3 Option A) |
| ADD | `task_participants` | — | No schema change; resolution logic only (RQ4) |
| ADD | `activity_log` | — | No schema change; new verb `task.owner_auto_resolved` (RQ5) |

### RQ8: Edge cases

| Scenario | Expected behaviour |
|---|---|
| Epic has `assignedUserId` but child was created WITH an explicit `assignedUserId` (same or different) | Child keeps its explicit value; `owner_override` = true if different from epic |
| Epic's `assignedUserId` is cleared (set to null) | Children with `owner_override = false` get `assignedUserId` cleared; children with override untouched |
| Epic is reclassified from `task` to `epic` (`reclassifyAsEpic`) while carrying an assignee | Existing children (if any from a prior decompose) are NOT backfilled (out of scope); new children created afterwards trigger RQ2a |
| Child is re-parented FROM one epic TO another epic with a different assignee | RQ2a fires: the child's `assignedUserId` updates to the new epic's assignee UNLESS `owner_override = true` |
| Child is detached from its epic (`parentTaskId` set to null) | No change to `assignedUserId` — the last-resolved owner sticks |
| Multiple epics, each with children, all changing assignee in rapid succession | Each `updateTask` call handles its own children synchronously; no cross-epic coupling |
| Child task is in a terminal lane (Done/Archived) when epic assignee changes | Still propagated — the PRD says "open issues" but "open" is ambiguous; the BA recommends propagating to ALL non-archived children regardless of status, because a Done task's owner may still be read by reports |

---

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
