> **PRD** — drafted by Ada (Sr. Product Mgr) · task #693
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Reactive Engine Repo Binding for Task #687

## Problem & Goal
Task #687 ("Confirm the auto-run side effect fires once per assignment, not twice") requires a custom reactive execution engine (signals, `autorun`, batch/transaction blocks, computed/derived propagation, and a scheduler with diamond‑dependency de-duplication).  
The currently bound branch (`builderforce/task-687` of `seanhogg/builderforce.ai`) contains **no such engine** – only `agent-runtime/`, root PRD markdown, and a single unrelated frontend file.  
**Goal:** Bind (or pull into this repo) the repository that actually holds the reactive engine code so that downstream development and testing for #687 can proceed without fabricating a stand‑in.

## Target Users / ICP Roles
- **Agent process / automated tester** that will run acceptance tests for #687.
- **Human reviewers** verifying that the correct codebase is in scope before #687 execution.

## Scope
- **In-scope:** Identification and binding (or integration) of the repository containing the reactive/auto‑run engine.  
  The engine must satisfy the needs of #687: signals, `autorun` side effect on assignment, batch/transaction blocks, computed/derived propagation, and a diamond‑dependency–aware scheduler.

## Functional Requirements
1. **FR‑1 – Engine module presence:** The bound repository must include a module or package that exports the following core primitives:  
   - `signal(initialValue)` (or equivalent mutable observable)  
   - `autorun(fn)` (side‑effect that re‑runs on dependency change)  
   - `batch(fn)` or `transaction(fn)` (executes updates atomically, deferring notifications)  
   - `computed(fn)` / `derived(fn)` (read‑only derived value with automatic dependency tracking)  
   - A scheduler that guarantees at most one execution per autorun for any given “tick” even with diamond dependencies.

2. **FR‑2 – Identifiability:** The engine must be locatable via file‑system paths (e.g., `src/reactive/` or `packages/autorun/`) or package manifests. References to `autorun`, `signal`, `computed`, and `scheduler` must appear in source code.

3. **FR‑3 – Binding action:** The repository must be accessible and bound to the task branch or project workspace such that dependency analysis, test frameworks, and human inspection can directly reference its code. If the engine lives in a separate repo, a dependency link (submodule, monorepo reference, or fetched artifact) must be established; if integration is needed, the code must be committed to the current repo.

4. **FR‑4 – File‑tree verification:** After binding, a file‑tree scan or glob (`**/*autorun*`, `**/*signal*`, `**/*reactiv*`, `**/*scheduler*`) must return non‑zero matches corresponding to the engine’s source files.

## Acceptance Criteria
- After executing the binding step, the repository root (or bound sub‑repo) contains source files that export or implement:  
  - A function/class named `signal` (or `observable` with equivalent behavior)  
  - A function named `autorun`  
  - A function named `batch` or `transaction`  
  - A function named `computed` or `derived`  
  - A scheduler mechanism that de‑duplicates notifications for diamond dependencies  
- A glob/search for `**/*autorun*` returns at least one result whose content includes the implementation of an `autorun` that triggers on assignment.
- No other code beyond the engine itself needs to be present; the bound repo is sufficient to resume #687 without fabricating missing pieces.

## Out of Scope
- Writing or executing the acceptance tests for #687 (`FR‑1` through `FR‑6` of that PRD).
- Fixing bugs, modifying API signatures, or enhancing the engine.
- Integrating the engine with the wider application; this PRD only covers making the correct engine source available.

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