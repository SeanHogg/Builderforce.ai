> **PRD** — drafted by Ada (Sr. Product Mgr) · task #775
> _Each agent that updates this PRD signs its change below._
> - 2026-08-03 — Business Analyst (task #775): authored Requirements section, grounded in existing RoleAssignmentService and project_role_assignments schema.

# Product Requirements Document: Role Assignment Replacement

## Problem & Goal
Currently, when assigning a user to a role that already has an assignee, the system can silently add a second assignee or return an error, leading to confusion about who holds the role. Users expect a role to be held by exactly one person at a time. The goal is to enforce single-assignee semantics for roles so that any new assignment automatically replaces the previous assignee, ensuring clarity and preventing duplicate responsibility.

## Target Users / ICP Roles
- Project Managers and Team Leads who allocate responsibilities.
- Administrators configuring project roles and memberships.
- Any user with permission to modify role assignments.

## Scope
The feature covers the core behavior change for role assignment flows: whenever a user is assigned to a role that already has an assignee, the previous assignee is immediately and atomically replaced by the new user. This applies to UI interactions (drag-and-drop, dropdown selection, etc.) and API calls.

## Functional Requirements

- **FR1: Single-Assignee Constraint** – A role can have at most one assigned user at any time.
- **FR2: Automatic Replacement** – When assigning a new user to a role currently occupied by a different user, the system must:
  - Remove the current assignee from the role.
  - Assign the new user to the role.
- **FR3: Atomic Operation** – The replacement must be executed as a single atomic transaction; no intermediate state where the role is unassigned but the new assignee is not yet set should be visible.
- **FR4: Idempotent Assignment** – Assigning the same user that already holds the role results in a no-op (success, no change).
- **FR5: Real-Time UI Update** – The frontend must reflect the replacement immediately without requiring a full page refresh.
- **FR6: API Behavior** – The existing role-assignment API endpoint must:
  - Accept a user identifier for the role.
  - If the role already has a different assignee, replace it and return a success response (e.g., 200 with details of the previous assignee that was replaced).
  - Avoid returning errors for duplicate assignments.
- **FR7: Audit Trail** – Every replacement must be logged with: timestamp, role identifier, previous assignee, new assignee, and the user who initiated the change.
- **FR8: User Notification (Optional)** – If notification infrastructure is present, the previously assigned user should be informed that they have been removed from the role.

## Acceptance Criteria

1. **Basic Replacement**  
   - Given role `R` is assigned to user `Alice`, when user `Bob` is assigned to role `R`, then `Alice` is unassigned, `Bob` is assigned, and role `R` shows `Bob` as the sole assignee.
2. **No Duplication**  
   - After the operation, no role ever lists more than one assignee in the system.
3. **UI Consistency**  
   - The role assignment UI updates within 2 seconds of the operation to display the new assignee and hides the previous assignee.
4. **API Contract**  
   - Calling `POST /api/roles/:id/assign` with `{ "userId": "bob" }` when `Alice` is assigned returns `200 OK` and `{ "replaced": "alice" }`.
5. **Idempotence**  
   - Assigning `Bob` again while `Bob` is already the assignee returns `200 OK` and does not trigger any replacement or audit entry (or logs a no-op if required).
6. **Audit Log**  
   - The audit system records an entry with `action: "role-assignment-replaced"` containing previous and new user details.

## Out of Scope

- Support for multiple simultaneous assignees on a single role.
- Role hierarchies or inherited assignments.
- Approval workflows or staged/request-based reassignment.
- Bulk replacement operations (handling an array of role assignments in one call).
- Customisable notification templates for role changes.
- Integration with external HR or identity systems causing cascading deprovisioning.

## Requirements

> _Authored by the business-analyst (task #775)._

This section decomposes the seven in-scope functional requirements (FR1–FR7) into detailed, testable sub-requirements grounded in the existing codebase: `RoleAssignmentService.create` in `api/src/application/kanban/roleAssignmentService.ts` and the `project_role_assignments` table established by migration `0281_project_role_assignments.sql`.

### REQ-1: Single-Assignee Data Constraint (FR1, FR2)

1. **REQ-1.1** — Within a given scope (tenant + optional project), a `role_key` must have **at most one** explicit assignment row at any time. The current unique index `uq_project_role_assignment` spans `(tenant_id, COALESCE(project_id, 0), role_key, assignee_kind, assignee_ref)`, which permits multiple rows with different `assignee_ref` values for the same role. The constraint must be narrowed or augmented so that `(tenant_id, COALESCE(project_id, 0), role_key)` is unique.

2. **REQ-1.2** — If a scope-level unique constraint is impractical (e.g. the `assignee_kind` dimension is still needed for separate agent/human/hire tracking), the service layer MUST enforce the constraint: before inserting, query for ANY existing row matching `(tenant_id, scope project_id, role_key)` and delete or overwrite it. This is the **replacement path**.

3. **REQ-1.3** — The replacement must handle all three `assignee_kind` values (`agent`, `human`, `hire`) uniformly. If role `R` is held by an agent and a human is assigned, the agent row is removed and the human row is inserted. Cross-kind replacement is the most common real-world scenario.

### REQ-2: Atomic Replacement in `RoleAssignmentService.create` (FR3)

4. **REQ-2.1** — The `create` method in `RoleAssignmentService` (currently lines 73–129 of `roleAssignmentService.ts`) must be refactored to perform a **delete-then-insert** within a single database transaction when a conflicting assignment exists.

5. **REQ-2.2** — The transaction must use `this.db.transaction(async (tx) => { ... })` so that both the DELETE and INSERT are committed atomically. No read-then-write gap outside a transaction is acceptable.

6. **REQ-2.3** — Before deleting the previous assignment, capture its full row (id, assigneeKind, assigneeRef, assigneeName) into memory so it can be returned to the caller and logged in the audit entry. Do not rely on post-deletion queries — the data is gone once the DELETE runs.

7. **REQ-2.4** — The cache invalidation (`invalidateCached(env, assignmentsKey(tenantId))`) must happen exactly once after the transaction commits, not before.

### REQ-3: Idempotent No-Op (FR4)

8. **REQ-3.1** — The existing idempotency check (lines 85–97) already compares `(tenantId, projectId, roleKey, assigneeKind, assigneeRef)`. This check must remain **first** — before any replacement logic — so assigning the same person again is a true no-op.

9. **REQ-3.2** — When the no-op path is taken, no audit entry is emitted and no cache invalidation occurs. The existing behaviour (returning the existing row) is correct and must be preserved.

### REQ-4: Replacement Path Logic (FR2, FR6)

10. **REQ-4.1** — After the idempotency check passes (the new assignee is different), query for any existing assignment for the same `(tenantId, projectId, roleKey)` — regardless of `assigneeKind` or `assigneeRef`. Use `and(eq(tenantId), scopeClause, eq(roleKey))` without filtering on assignee fields.

11. **REQ-4.2** — If a conflicting row exists, execute the atomic delete+insert (REQ-2). If none exists, proceed with a plain insert (the current happy path).

12. **REQ-4.3** — The return value must indicate whether a replacement occurred. Extend the `RoleAssignment` return type or the method's return signature to include a `replaced: RoleAssignment | null` field so callers (including the API layer) can surface it.

### REQ-5: Audit Trail for Replacements (FR7)

13. **REQ-5.1** — The replacement must emit a `recordActivity` call with verb `'role.replaced'` (distinct from the existing `'role.assigned'` used on first-assignment). The activity metadata must include:

    ```ts
    metadata: {
      assigneeKind: <new>,
      assigneeRef: <new>,
      projectId,
      replaced: {
        id: <previous assignment id>,
        assigneeKind: <previous>,
        assigneeRef: <previous>,
        assigneeName: <previous name>,
      }
    }
    ```

14. **REQ-5.2** — The activity `summary` should read: `"Replaced {previousName} with {newName} on {roleKey}"`.

15. **REQ-5.3** — Use the existing `recordActivity` function imported from `../activity/activityLog` and `resolveActorByRef` for the initiating actor. Follow the existing best-effort pattern (try/catch, never fail the assignment).

### REQ-6: Database Migration for Constraint (FR1)

16. **REQ-6.1** — Create a new migration that drops `uq_project_role_assignment` and replaces it with a narrower unique index:

    ```sql
    DROP INDEX IF EXISTS uq_project_role_assignment;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_project_role_assignment
      ON project_role_assignments(tenant_id, COALESCE(project_id, 0), role_key);
    ```

17. **REQ-6.2** — Before dropping the old index, the migration must deduplicate: if multiple rows exist for the same `(tenant_id, COALESCE(project_id, 0), role_key)`, keep the **most recent** (`MAX(created_at)`) and delete the rest. This is a data-cleanup precondition for adding a tighter unique constraint.

### REQ-7: API Layer Changes (FR6)

18. **REQ-7.1** — Identify the route/handler that exposes role assignment (likely in the kanban or roster HTTP layer) and update it to return the `replaced` field from the service response in the JSON body (e.g. `{ "replaced": { "id": "...", "assigneeName": "Alice" } }`).

19. **REQ-7.2** — The HTTP status code remains `200` for both new assignments and replacements. No `409 Conflict` or error response for a "duplicate" assignment — that is now handled by replacement or idempotent no-op.

### REQ-8: Caching Considerations

20. **REQ-8.1** — The cache key `kanban:roleAssignments:{tenantId}` covers all rows for the tenant. Since replacement deletes one row and inserts another (net unchanged count), the cache should be invalidated once per mutation (already implemented). No change needed beyond ensuring invalidation happens exactly once inside the transaction path.

### REQ-9: Backward Compatibility

21. **REQ-9.1** — The `listForRoster` and `listForScope` methods must continue to work unchanged. After the constraint change, they will naturally return at most one row per `(scope, roleKey)`, which is the desired behaviour.

22. **REQ-9.2** — The `remove` method (lines 133–138) is unchanged and continues to delete by id.

### Traceability Matrix

| PRD FR | REQ(s) |
|--------|--------|
| FR1 Single-Assignee | REQ-1.1, REQ-1.2, REQ-6 |
| FR2 Automatic Replacement | REQ-1.2, REQ-1.3, REQ-4 |
| FR3 Atomic Operation | REQ-2.1 through REQ-2.4 |
| FR4 Idempotent Assignment | REQ-3.1, REQ-3.2 |
| FR5 Real-Time UI Update | REQ-8.1 (cache invalidation), REQ-7 |
| FR6 API Behavior | REQ-7.1, REQ-7.2, REQ-4.3 |
| FR7 Audit Trail | REQ-5.1 through REQ-5.3 |
| FR8 Notification | Out of scope (optional — not required for MVP) |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
