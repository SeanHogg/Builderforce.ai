> **PRD** — drafted by Ada (Sr. Product Mgr) · task #770
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Epic Ownership Behavior with No Assignee

## Problem & Goal
Currently, when an Epic issue has no assignee, the Owner role field correctly remains unstaffed (empty). This behavior is intentional and must be explicitly defined and preserved to prevent accidental auto-population of the Owner field. The goal of this PRD is to formalize this requirement, ensuring that no future development, automation, or configuration change inadvertently breaks this logic. The expected outcome is that an Epic without an assignee will always have an empty Owner field, unless a user or approved automation explicitly sets the Owner independent of the assignee.

## Target Users / ICP Roles
- **Project Managers / Program Managers** who rely on the Owner field to indicate responsible individuals, separate from the day-to-day assignee.
- **Team Leads / Scrum Masters** who use the Owner field for accountability tracking.
- **Jira Administrators** configuring fields, workflows, and automation rules.
- **Integration developers** building tools that read or write issue fields, needing clear contract for empty assignee scenarios.

## Scope
- Only applies to the **Epic** issue type.
- Applies to the **Owner role field** (a custom field representing project ownership; may be named “Owner” or similar).
- Covers all lifecycle events: creation, editing, bulk changes, transitions, REST API calls, and automation triggers.
- Ensures that the Owner field remains **null/empty** when the assignee is unset (empty).

## Functional Requirements
- **FR1:** When a new Epic is created without an assignee, the Owner field must be stored and displayed as empty (no value).
- **FR2:** When an existing Epic’s assignee is cleared (set to “Unassigned”), the Owner field must be cleared (set to empty) automatically. If the Owner was already empty, it remains empty.
- **FR3:** The system shall not auto-populate the Owner field with the reporter, project lead, default assignee, or any other user when the assignee is empty.
- **FR4:** Any automation rule (built-in or third-party) that modifies the assignee must not inadvertently set the Owner field unless the rule is explicitly designed to set the Owner independently and is approved for that purpose.
- **FR5:** The REST API must accept update requests that leave the assignee empty while allowing the Owner field to remain null; API responses and issue reads must reflect an empty Owner field when no value is set.

## Acceptance Criteria
- **AC1:** Create a new Epic with assignee field left unset → verify Owner field is empty in both UI and database.
- **AC2:** Take an Epic that has an assignee and a populated Owner field; clear the assignee → Owner field becomes empty after save.
- **AC3:** Bulk-edit multiple Epics to remove the assignee → all affected Epics must have their Owner field cleared.
- **AC4:** Trigger a workflow transition that uses a post-function to clear the assignee → Owner field must be empty post-transition.
- **AC5:** Use the REST API to update an Epic, setting `assignee` to `null` → the `Owner` custom field value must be `null` or missing.
- **AC6:** In the issue view, the Owner field must display as empty (no placeholder text such as “None” or “Unassigned”) when no value is set.
- **AC7:** Regression test: after any future changes to issue field logic or ownership features, all above acceptance criteria still pass.

## Out of Scope
- Behavior for non-Epic issue types (Story, Task, Bug, etc.) — those may have different ownership rules.
- The logic that determines how the assignee field itself becomes populated or cleared (auto-assignment, component lead rules, etc.).
- Visual presentation or label of the Owner field (e.g., its name, position on screens, or display on boards).
- Cloning Epics or moving them to projects with different field configurations, except where such operations violate the core requirement (FR1–FR3).
- Notifications or workflow post-functions triggered by the Owner field being empty, unless they conflict with this specification.

## Requirements

**BA sign-off** — _J. Analyst · 2026-08-02_

### Domain mapping — PRD concepts → codebase

The PRD was authored in issue-tracker language ("Owner role field," "custom field"). In this codebase (seanhogg/builderforce.ai), the equivalents are:

| PRD concept | Codebase representation |
|---|---|
| **Epic** | `Task` with `taskType === TaskType.EPIC` (`api/src/domain/task/Task.ts`) |
| **Assignee** | `tasks.assignedUserId` (human), `assignedAgentHostId` (host agent), or `assignedAgentRef` (cloud agent). Mutually exclusive. |
| **Owner role / Owner field** | The **`product-owner`** role slot in the **Participation Manifest** (`ticket_participants` table). A task's manifest is derived from its board's `swimlane_requirements` template via `deriveManifest()` in `api/src/application/kanban/ticketParticipants.ts`. Each slot gets an assignee resolved from `project_role_assignments` → `resolveRoleCapableAgents`. A slot with no resolved resource lands in `unstaffed` state — which IS the "empty Owner field" the PRD requires. |
| **Project 360 "owner"** | `ownerOf()` in `api/src/application/project/computeProject360.ts` — maps `assignedUserId`/`assignedAgentHostId`/`assignedAgentRef` to a workforce member. Returns `null` when all three are null. This is a *read-side projection* for the health dashboard, NOT the Owner role field. |

### FR-by-FR traceability

#### FR1: New Epic created without assignee → Owner empty

**Current state: SATISFIED.** Two independent axes guarantee this:

1. **Task row:** `Task.create()` initialises `assignedUserId` from the DTO (default `null`). A new Epic created via `TaskService.createTask({ taskType: 'epic' })` with no `assignedUserId` stores `NULL` in the column. The `ownerOf()` projection in the project 360 returns `null`.

2. **Participation Manifest:** `TicketParticipantsService.deriveManifest()` resolves the `product-owner` role by calling `resolveAssignee()`, which walks `project_role_assignments` and then `resolveRoleCapableAgents`. It does NOT inspect `tasks.assignedUserId`. If no explicit role pin exists for `product-owner` on this project, the slot lands `unstaffed` — the correct "empty" display.

**Guardrail needed:** None — the two paths are already independent.

#### FR2: Clearing an Epic's assignee clears the Owner

**Current state: PARTIALLY DECOUPLED — warrants a design decision.**

The Participation Manifest's `product-owner` slot is resolved independently of `tasks.assignedUserId` (see FR1). Clearing `assignedUserId` on an Epic does NOT automatically clear the `product-owner` participant slot if one was already resolved (e.g. via a project role assignment pin). The two concepts are deliberately decoupled:

- `assignedUserId` = "who's working this ticket day-to-day"
- `product-owner` role = "who's accountable for value and acceptance"

The PRD assumes they are coupled (clearing assignee → clearing Owner). In this codebase they are not, and that is arguably correct: a project may have a pinned Product Owner via `project_role_assignments` who should remain on the manifest regardless of which individual is assigned the ticket.

**Recommendation:** Do NOT implement FR2 as an automatic cascade. Instead, document that the `product-owner` role is set independently through `project_role_assignments` and the resource assessment flow (`addParticipant`). If a human explicitly wants to clear the Owner, they do so by removing the resource assessment or unpinning the role assignment — not by clearing the assignee. This should be confirmed with the PM (Ada) before closing this PRD.

**If the PM insists on FR2 as written:** The implementation would need a trigger in `TaskService.updateTask()` (or `TaskRepository.update()`) that, on detecting `assignedUserId` being set to `null` on an Epic, also calls `TicketParticipantsService.addParticipant()` with `assignee: null` for the `product-owner` role — effectively unstaffing that slot.

#### FR3: No auto-population of Owner from reporter/lead/default

**Current state: SATISFIED.** The participation manifest resolver (`resolveAssignee`) consults only:

1. `project_role_assignments` — explicit pinning by an admin/manager
2. `resolveRoleCapableAgents` — the first capable cloud agent for the role

It does NOT fall back to the task's reporter (`tasks` has no reporter column — creation is attributed via execution audit), the project lead, or any "default assignee" concept. An `unstaffed` slot remains `unstaffed` unless a resource is explicitly assigned.

Additionally, `reclassifyAsEpic()` (used by the agent-driven decomposition path) preserves `assignedUserId` from the original task (it only clears the *agent* assignees, since an Epic is a planning container the children execute). This is correct — a human owner carried over from a task-to-Epic reclassification is a deliberate, data-preserving act, not auto-population.

#### FR4: Automation must not inadvertently set the Owner

**Current state: SATISFIED, with one audit point.**

Automation touch-points that modify assignees:

| Path | Risk | Verdict |
|---|---|---|
| `ManagerService` → `assignOwner.ts` | Assigns `assignedUserId`/`assignedAgentRef`/`assignedAgentHostId`. Does NOT touch `ticket_participants`. | Safe |
| `TaskService.updateTask()` | Accepts `assignedUserId` in `UpdateTaskDto`. Does NOT cascade to the manifest. | Safe |
| `EpicDecomposer` / `onAssignedToAgent` | Reclassifies task → Epic via `reclassifyAsEpic()`. Clears agent assignees; preserves `assignedUserId`. Children are fanned out with fresh assignees that do not affect the Epic's manifest. | Safe |
| `concludeCeremony.ts` | Bulk-clears `assignedUserId` on reassignable tasks. Does NOT touch participants. | Safe |
| `demoSeedService.ts` | Seeds Epics with no `assignedUserId` by default. | Safe |
| `MigrationService` | Maps external assignee → `assignedUserId`. Does NOT populate `ticket_participants`. | Safe |

**Audit point:** Any future automation added to the `kanban` or `manager` modules that calls `addParticipant` with a `product-owner` role key AND derives the assignee from `tasks.assignedUserId` would violate FR4. A code comment on `addParticipant` documenting this invariant is recommended (see Implementation Notes).

#### FR5: REST API accepts empty assignee + null Owner

**Current state: SATISFIED.**

- `TaskService.updateTask()` accepts `UpdateTaskDto` where `assignedUserId` is optional (`string | null | undefined`). Omitting it leaves the field unchanged; passing `null` clears it.
- The REST routes (`api/src/routes/tasks.ts`) map PATCH body → `UpdateTaskDto` → `TaskService.updateTask()`.
- The Participation Manifest is NOT modified by the task update route — `product-owner` slots are managed through the separate kanban routes (`POST /tasks/:id/participants` etc.).
- No coupling exists that would reject a payload with `assignedUserId: null` because the Owner is empty, or auto-fill the Owner because the assignee was set.

### Key invariants to preserve

The following must hold true after any future change; they form the regression contract for AC7:

1. **`resolveAssignee()`** (`ticketParticipants.ts`) shall never inspect `tasks.assignedUserId` as a fallback for the `product-owner` role.
2. **`reclassifyAsEpic()`** (`Task.ts`) shall preserve `assignedUserId` and shall never introduce a side-effect on `ticket_participants`.
3. **`TaskService.updateTask()`** shall never cascade an `assignedUserId` change into the Participation Manifest.
4. **`deriveManifest()`** shall leave the `product-owner` slot `unstaffed` when no `project_role_assignments` row or capable agent exists — it shall not synthesise an owner from any other task field.
5. **`addParticipant()`** called for `product-owner` with no explicit `assignee` and no role-capable agent shall produce `unstaffed`, not fall back to `tasks.assignedUserId`.
6. **Manager automation** (`assignOwner`, `ceremony`, `triageStage`) shall not write to `ticket_participants` for the `product-owner` role as a side-effect of changing `assignedUserId`.

### Data-flow diagram (current state)

```
Epic creation / update
        │
        ├─► tasks table (assignedUserId = null | value)
        │       │
        │       └─► computeProject360.ownerOf() ──► workforce member (or null)
        │
        └─► Participation Manifest (separate path)
                │
                ├─► deriveManifest()
                │       └─► resolveAssignee()
                │               ├─► project_role_assignments (pinned)
                │               └─► resolveRoleCapableAgents (first capable agent)
                │                       │
                │                       └─► NO lookup of tasks.assignedUserId
                │
                └─► product-owner slot state:
                        ├─ assigned  (resource found)
                        └─ unstaffed (no resource — THE "empty Owner")
```

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
