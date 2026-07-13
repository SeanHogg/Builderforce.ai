# PRD: Regression Test — `tasks.update` Parent Task ID Preservation

> **PRD** — drafted by Ada (Sr. Product Mgr) · task #690
> _Each agent that updates this PRD signs its change below._

## Problem & Goal

A regression was identified where calling `tasks.update` to change `assignedAgentRef` on a subtask could silently drop the `parentTaskId` field or trigger duplicate auto-run side effects. No automated test currently guards against this behavior, leaving the system vulnerable to silent regressions in task hierarchy integrity and side-effect correctness.

**Goal:** Add a targeted regression test suite that permanently guards against:
1. `parentTaskId` being cleared or overwritten when `assignedAgentRef` is updated.
2. The auto-run side effect firing zero times or more than once per qualifying `tasks.update` call.

---

## Target Users / ICP Roles

| Role | Relevance |
|---|---|
| Backend engineers | Primary authors and consumers of this test |
| QA / SDET | Validate coverage gates are met |
| On-call engineers | Rely on this test catching production regressions in CI |

---

## Scope

This PRD covers a single regression test file (or suite block) added to the existing test layer for the `tasks` domain. It does not require changes to production code unless a bug is confirmed during test authoring.

---

## Functional Requirements

### FR-1 — Test: `parentTaskId` is preserved on `assignedAgentRef` update

- **Given** a parent task exists with a known `parentTaskId`.
- **And** a child (sub)task exists linked to that parent via `parentTaskId`.
- **When** `tasks.update` is called on the child task with only `assignedAgentRef` changed.
- **Then** the returned task document retains the original `parentTaskId` value unchanged.
- **And** a subsequent `tasks.get` (or equivalent read) on the same task ID also returns the original `parentTaskId`.

### FR-2 — Test: Auto-run side effect fires exactly once

- **Given** the same child task setup as FR-1.
- **When** `tasks.update` is called with a new `assignedAgentRef`.
- **Then** the auto-run side effect is triggered exactly **one** time.
- **And** no duplicate side-effect invocations are recorded within the same event loop tick or async flush window.

### FR-3 — Test: No side effect on a no-op `assignedAgentRef` update

- **Given** a child task with an `assignedAgentRef` already set to `agentA`.
- **When** `tasks.update` is called with `assignedAgentRef` set to the same `agentA` value.
- **Then** `parentTaskId` is still preserved.
- **And** the auto-run side effect fires **zero** times (no change detected).

### FR-4 — Test: `parentTaskId` is preserved when other fields are updated concurrently

- **Given** a child task with a `parentTaskId`.
- **When** `tasks.update` is called updating both `assignedAgentRef` and at least one other mutable field (e.g., `status`, `metadata`).
- **Then** `parentTaskId` is unchanged in the persisted document.

### FR-5 — Side-effect spy / mock isolation

- The test suite must instrument or mock the auto-run side-effect handler to count invocations without triggering real downstream execution.
- The spy must be reset between each test case to prevent cross-test contamination.

---

## Acceptance Criteria

| # | Criterion | Verification method |
|---|---|---|
| AC-1 | All four functional test cases (FR-1 through FR-4) exist as discrete, named test cases | Code review + test runner output |
| AC-2 | Tests pass consistently in CI with zero flakiness across 10 sequential runs | CI pipeline report |
| AC-3 | Tests fail (red) when `parentTaskId` stripping is artificially introduced into `tasks.update` | Mutation / forced regression check |
| AC-4 | Tests fail (red) when the auto-run side effect is called twice artificially | Mutation / forced regression check |
| AC-5 | No real external services or agents are invoked during the test run | Network/spy assertion or hermetic test environment |
| AC-6 | Test file is co-located with or adjacent to existing `tasks` unit/integration tests and follows project naming conventions | Code review |
| AC-7 | Each test has a descriptive name referencing the exact scenario being guarded | Code review |
| AC-8 | The side-effect mock is explicitly reset in `beforeEach` or `afterEach` | Code review |

---

## Out of Scope

- Changes to the `tasks.update` production implementation (unless the test reveals an unfixed bug, in which case a separate ticket is created).
- Testing `parentTaskId` behavior for `tasks.create`, `tasks.delete`, or bulk-update operations.
- End-to-end or load testing of the auto-run pipeline.
- UI or API-contract testing layers.
- Changing or expanding the auto-run trigger logic itself.
- Migration or backfill of existing task documents that may already have missing `parentTaskId` values.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored.