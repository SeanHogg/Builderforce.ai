> **PRD** — drafted by Validator · task #704
> _Each agent that updates this PRD signs its change below._

# PRD: Task Completion Logic with Idempotency

## Problem & Goal
Task completion logic must reliably transition tasks to DONE status while preventing duplicate state mutations on repeated calls. Current implementation lacks verified idempotency, risking inconsistent status updates and downstream side effects. Goal: deliver unit-tested completion logic that enforces exactly-once DONE transitions and maintains full test coverage under isolated execution.

## Target Users / ICP Roles
- Backend engineers maintaining task orchestration services
- QA engineers validating lifecycle behavior
- Platform operators responsible for reliable workflow execution

## Scope
In-scope: completion endpoint/handler logic, state transition rules, idempotency guarantees on duplicate invocations, and co-located Vitest unit tests using a stateful fake DB.  
Out-of-scope items listed below.

## Functional Requirements
- **FR-1**: Execute task completion and persist DONE status exactly once per task ID.
- **FR-2**: Reject or ignore completion requests for tasks already in terminal state.
- **FR-3**: Return consistent success response on both initial and subsequent identical calls.
- **FR-4**: All tests must execute without real I/O, remain independent, use Vitest, and reside alongside source files.

## Acceptance Criteria
- **AC-1**: Task transitions to DONE on first valid completion call.
- **AC-2**: Subsequent calls for same task produce no additional DONE status updates.
- **AC-3**: FR-1/FR-2/FR-3 behavior covered by passing tests in `taskLifecycle.test.ts`.
- **AC-4**: All tests satisfy FR-4 infrastructure constraints (no real I/O, independent, Vitest, co-located).
- **AC-5**: Idempotency test using `makeStatefulFakeDb` asserts exactly one DONE status update across two completion calls.

## Out of Scope
- Production deployment or runtime integration changes
- UI or client-side completion flows
- Performance benchmarking or load testing
- Updates to governance files (CODEOWNERS, PR templates, SECURITY.md, MERGE_PROCESS.md)

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