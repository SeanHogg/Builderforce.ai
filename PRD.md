> **PRD** — drafted by Ada (Sr. Product Mgr) · task #705
> _Each agent that updates this PRD signs its change below._

# PRD: Audit of tasks.update parentTaskId Mutation (task-688)

## Problem & Goal
A bug was identified where updating a task’s `parentTaskId` could be inadvertently cleared or overwritten during the `tasks.update` mutation. The root cause was not a single drop site but a combination of missing guards in the domain, service, and repository layers. A three-layer patch was applied in task-689. This audit task confirms that the fix is correct, that no other code paths bypass the fix, and that regression tests cover the identified failure modes.

**Goal:** Perform a structured audit of the `tasks.update` handler to:
- Document the exact root cause (file/line/mechanism).
- Verify the three-layer patch (domain, service, repository) is applied correctly.
- Confirm that auto-run side effects do not overwrite `parentTaskId`.
- Validate that regression test coverage meets all acceptance criteria.

## Target Users / ICP Roles
- **Engineering team** (backend developers, QA) responsible for the task management API.
- **Code reviewers** needing evidence that the fix is complete and safe.
- **Future maintainers** seeking a documented audit trail for the mutation.

## Scope
The audit covers the following areas of the `tasks.update` flow:
1. Input validation schema (`UpdateTaskDto`).
2. Resolver data-flow from route → service → repository.
3. Handling of `assignedAgentRef` (branching logic).
4. Post-write side effects (auto-run triggers, child task creation).
5. Database write semantics (SET clause vs full replace).
6. Root cause documentation.
7. Fix implementation verification (three-layer patch from task-689).
8. Regression test coverage (`ticketUpdateParentIdPreserved.test.ts`).

## Functional Requirements
- **FR-1: Schema audit** – Confirm that `parentTaskId` is explicitly declared in the update schema and that no strict/allowlist stripping removes it.
- **FR-2: Resolver data-flow trace** – Trace the `parentTaskId` field from the incoming DTO through the service layer down to the repository’s save call.
- **FR-3: assignedAgentRef code path audit** – Verify that no private branching on `assignedAgentRef` alters or replaces the `parentTaskId` payload.
- **FR-4: Auto-run side-effect audit** – Inspect post-write hooks (e.g., `onAssignedToAgent`) to ensure they do not perform a second write that clears or overwrites the parent task’s `parentTaskId`.
- **FR-5: Database write audit** – Validate that the repository uses an explicit SET clause (or equivalent) for `parentTaskId` and does not rely on whole-object replacement that could drop the field.
- **FR-6: Root cause documentation** – Identify and document the exact mechanism that allowed `parentTaskId` to be lost, including file paths, line numbers, and a description.
- **FR-7: Fix implementation review** – Review the three-layer patch (domain, service, repository) to confirm it correctly guards against undefined→null coercion and omitted field mutation.
- **FR-8: Regression test coverage** – Ensure that `ticketUpdateParentIdPreserved.test.ts` covers the following scenarios:
  - Explicit `parentTaskId` persisted correctly.
  - `parentTaskId` and `assignedAgentRef` both survive in a single tracked write.
  - Auto-run side effects do not clear/overwrite `parentTaskId`.
  - Omitted `parentTaskId` retains its existing value (no accidental null-out).

## Acceptance Criteria
- **AC-1:** The audit confirms that the root cause is documented with file, line, and a clear explanation of the mechanism (no drop site).
- **AC-2:** The three-layer patch from task-689 is present and verified in the domain (`Task.update`), service, and repository layers.
- **AC-3:** All four regression test scenarios (explicit, combined, side-effect, omitted) pass, and the test confirms only one tracked write per parent task.
- **AC-4:** No additional code changes are required; the audit only validates and documents the existing fix.
- **AC-5:** The audit report is complete and ready for stakeholder review.

## Out of Scope
- Performance or load testing of the `tasks.update` endpoint.
- Security review beyond the data-integrity concerns of the `parentTaskId` field.
- New feature development or refactoring beyond the three-layer fix already applied.
- Audit of other task mutations or unrelated API endpoints.

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