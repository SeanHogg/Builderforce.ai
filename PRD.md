> **PRD** — drafted by Ada (Sr. Product Mgr) · task #687
> _Each agent that updates this PRD signs its change below._

# PRD: Auto-Run Side Effect Execution Guarantee

## Problem & Goal

There is an unverified behavioral contract around auto-run side effects: when a value is assigned, the associated side effect must fire **exactly once**. Duplicate firings cause bugs such as double API calls, duplicate UI updates, and corrupted state. The goal is to confirm—through targeted tests and, if necessary, corrective implementation—that every auto-run side effect fires exactly once per assignment, never zero times and never more than once.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Frontend / fullstack engineers** | Rely on reactive primitives (signals, observables, stores) behaving predictably |
| **QA / test engineers** | Need deterministic, reproducible side-effect counts to write reliable assertions |
| **Platform / infra engineers** | Depend on side-effect guarantees when wiring event pipelines and cache invalidation |

---

## Scope

### In Scope

- The auto-run / reactive execution engine and its scheduling logic
- All code paths that trigger side-effect execution upon an assignment (direct set, batch set, derived/computed propagation)
- Unit and integration tests that assert exactly-once firing semantics
- Any bug fixes required to uphold the exactly-once contract

### Out of Scope

- Unrelated reactivity features (lazy evaluation, memoization caching correctness, etc.)
- Side effects triggered by reads (get-side-effects), not writes
- Performance profiling or optimization work beyond what is needed to fix double-firing
- Changes to the public API surface

---

## Functional Requirements

### FR-1 — Single Fire on Simple Assignment
When a reactive variable is assigned a new value, every registered auto-run side effect that depends on that variable **must execute exactly once**.

### FR-2 — Single Fire on Batch Assignment
When multiple reactive variables are updated inside a batch/transaction block, each dependent auto-run side effect **must execute exactly once** after the batch completes, regardless of how many of its dependencies changed within that batch.

### FR-3 — Single Fire on Derived/Computed Propagation
When an assignment causes a computed/derived value to update, any auto-run side effect depending on that derived value **must execute exactly once** per batch cycle.

### FR-4 — No Fire on Same-Value Assignment
When a reactive variable is assigned a value **equal to its current value** (by the configured equality check), no auto-run side effect **must** fire.

### FR-5 — Execution Count Is Observable
The side-effect execution count must be programmatically observable in tests (e.g., via a counter mock, spy, or stub) to allow deterministic assertion.

### FR-6 — Scheduler De-duplication
The internal scheduler must de-duplicate pending auto-run jobs queued within the same microtask/tick so that diamond-dependency graphs (A → B, A → C, B+C → D) do not cause D's side effect to fire more than once.

---

## Acceptance Criteria

| ID | Criterion | Pass Condition |
|---|---|---|
| AC-1 | Simple assignment fires side effect once | Spy call count === 1 after one assignment |
| AC-2 | Rapid successive assignments fire side effect once per assignment | Spy call count === N after N sequential assignments (one per assignment, not batched) |
| AC-3 | Batch of M dependency changes fires side effect once | Spy call count === 1 after a single batch touching M dependencies |
| AC-4 | Diamond-dependency graph fires leaf side effect once | Spy call count === 1 when common ancestor is assigned once |
| AC-5 | Same-value assignment does not fire side effect | Spy call count === 0 after assigning identical value |
| AC-6 | Derived value propagation fires side effect once | Spy call count === 1 when source changes, causing computed change |
| AC-7 | All existing reactive test suites pass without regression | CI green on full test run |
| AC-8 | No new test is skipped or marked `xtest`/`xit` | Zero skipped tests in the auto-run suite |

---

## Out of Scope

- Subscription/observable patterns not using the auto-run primitive
- Server-side rendering or SSR hydration edge cases
- Cross-context (worker thread / iframe) reactivity
- Async side effects and cancellation semantics
- Throttle, debounce, or rate-limiting wrappers around auto-run
- Changes to equality-check configuration or custom comparators

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