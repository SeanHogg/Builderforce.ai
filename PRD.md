> **PRD** — drafted by Ada (Sr. Product Mgr) · task #687
> _Each agent that updates this PRD signs its change below._

# PRD: Auto-Run Side Effect Execution Guarantee

## Problem & Goal

When an assignment triggers an auto-run side effect (e.g., a reactive callback, lifecycle hook, watcher, or event handler bound to a value assignment), the side effect is firing **twice** instead of **once** in at least one confirmed code path. This causes duplicate API calls, incorrect state mutations, redundant renders, and unpredictable application behavior.

**Goal:** Guarantee that every auto-run side effect fires **exactly once** per assignment, and prove this guarantee with a targeted, reproducible test.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Frontend / fullstack engineers** | Rely on predictable reactivity; duplicate side effects cause UI bugs and wasted network requests |
| **QA / SDET engineers** | Need a deterministic test harness to confirm the fix and prevent regression |
| **Platform / infra engineers** | Duplicate effects can cause double-writes to databases or message queues |

---

## Scope

This work covers the specific execution lifecycle of **auto-run side effects triggered by a single assignment event** within the reactive system (scheduler, signal graph, or equivalent mechanism). It does not cover manually invoked effects or effects triggered by multiple distinct assignments.

---

## Functional Requirements

### FR-1 — Single Execution Per Assignment
When a value is assigned exactly once, any auto-run side effect registered against that value **must execute exactly one time** before the next assignment or tick boundary.

### FR-2 — No Deduplication Suppression
The fix must not prevent legitimate re-execution when a **second distinct assignment** occurs. Clamping, deduplication, or batching strategies must not collapse two real assignments into zero or one effect invocation.

### FR-3 — Synchronous and Asynchronous Paths
The single-execution guarantee applies to both:
- Synchronous assignment → synchronous effect
- Synchronous assignment → asynchronous/scheduled effect (e.g., microtask, `requestAnimationFrame`, `setTimeout`)

### FR-4 — No Side-Effect State Leakage Between Tests
The effect execution counter must be reset cleanly between test cases. Any global scheduler state, signal registry, or subscription list must be torn down after each test.

### FR-5 — Observable Execution Count
The system must expose (or the test must instrument) a reliable mechanism to count how many times a specific side effect callback was invoked — e.g., a spy, mock function, or explicit counter variable.

---

## Acceptance Criteria

```
AC-1  GIVEN a reactive variable with one registered auto-run side effect
      WHEN the variable is assigned a new value exactly once
      THEN the side effect callback is invoked exactly 1 time

AC-2  GIVEN a reactive variable with one registered auto-run side effect
      WHEN the variable is assigned a new value twice in sequence
      THEN the side effect callback is invoked exactly 2 times (once per assignment)

AC-3  GIVEN the same setup as AC-1
      WHEN the assignment occurs inside an async context (Promise, setTimeout, etc.)
      THEN the side effect callback is still invoked exactly 1 time after the scheduler flushes

AC-4  GIVEN two independent reactive variables each with their own auto-run side effect
      WHEN each variable is assigned once
      THEN each respective side effect fires exactly 1 time and neither fires for the other's assignment

AC-5  GIVEN the test suite runs AC-1 through AC-4 in sequence
      WHEN each test begins
      THEN all effect counters and scheduler state are in a clean initial state (no carry-over from prior tests)
```

---

## Implementation Notes

- Investigate **double-registration** in the subscriber/dependency tracking phase — a common root cause is the effect being added to a dependency set twice (e.g., during both the `track` and `trigger` phases).
- Inspect scheduler **flush logic** for redundant queue processing (e.g., a queue that re-enqueues an effect before draining).
- Check whether `cleanup` / `dispose` functions are being called prematurely, causing the effect to re-subscribe mid-flush.
- Use a `vi.fn()` / `jest.fn()` spy (or equivalent) as the canonical counter — do not rely on internal flags that may themselves be buggy.

---

## Out of Scope

- Effects triggered by **computed/derived values** (separate dependency graph layer)
- Batch-update APIs that intentionally coalesce multiple assignments into a single effect run
- Performance optimization of the scheduler beyond correctness
- Changes to the public API surface of the reactive system
- Cross-framework compatibility (Vue, MobX, Solid, etc.) — this targets the project's own reactive primitive only
- Visual regression or end-to-end browser testing

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._