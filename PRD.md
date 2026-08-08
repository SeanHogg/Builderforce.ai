> **PRD** — drafted by Ada (Sr. Product Mgr) · task #693
> _Each agent that updates this PRD signs its change below._
> - **Business Analyst** (Requirements §) — 2026-08-03 — authored the Requirements section with 6 stakeholder requirements (RQ-1 through RQ-6), 4 assumptions, dependency map, 3 NFRs, and full traceability matrix to #687 test cases.

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

_Owned by the business-analyst._

### Business Context

Task #687 ("Confirm the auto-run side effect fires once per assignment, not twice") is currently **blocked** because its branch (`builderforce/task-687` of `seanhogg/builderforce.ai`) contains no reactive/auto-run engine code. The branch holds only `agent-runtime/`, root PRD markdown, and a single unrelated frontend visualization file (`Builderforce.ai/frontend/src/components/ide/EvermindBrainMap.tsx`). Writing acceptance tests against code that does not exist is not acceptable — the engine source must be physically present before #687 can proceed.

### Stakeholder Requirements

#### RQ-1 — Engine Source Availability (BLOCKING)
The reactive/auto-run engine source code must be physically present on the task branch or in a bound dependency such that any agent executing #687 can `import`/`require` the engine primitives (`signal`, `autorun`, `batch`/`transaction`, `computed`/`derived`, and the scheduler).

- **Priority:** Must-have. #687 cannot proceed without this.
- **Rationale:** FR-1 through FR-6 of the #687 PRD all reference engine primitives. A stand-in or mocked engine would invalidate the acceptance tests.

#### RQ-2 — API Contract Fidelity
The bound engine must implement the semantics described in FR-1 of this PRD and #687's PRD:

| Primitive | Required behavior |
|-----------|-------------------|
| `signal(initialValue)` | Mutable observable with `.get()` / `.set(val)` accessors; setting a value marks the signal dirty and schedules dependent `autorun`s and `computed`s for re-evaluation. |
| `autorun(fn)` | Registers `fn` as a reactive side-effect. On invocation, `fn`'s reads of signals/computeds are tracked as dependencies. Any subsequent assignment to a dependency re-runs `fn` exactly once per scheduler tick, even across diamond dependency graphs. |
| `batch(fn)` / `transaction(fn)` | Defers all notifications until `fn` completes. Intermediate signal writes inside the batch do not trigger `autorun` or `computed` re-evaluation. Supports nesting (only the outermost batch flushes). |
| `computed(fn)` / `derived(fn)` | Read-only derived value. Lazy — re-evaluates only when read and a dependency is dirty. Caches result until dirtied. |
| Scheduler | Guarantees at most one execution per `autorun` per tick. De-duplicates: if an `autorun` depends on two signals that both change in the same tick (diamond), it runs exactly once. |

- **Priority:** Must-have.
- **Rationale:** The #687 acceptance tests will assert these exact behaviors. A partial or incompatible engine wastes testing effort.

#### RQ-3 — Binding Decision
One of the following binding paths must be selected and executed:

| Path | Description | When to use |
|------|-------------|------------|
| **A — Submodule** | `git submodule add <engine-repo-url> packages/reactive-engine/` | The engine lives in its own public/private repo and is versioned independently. |
| **B — In-repo commit** | Copy the engine source tree directly into this repo (e.g., `packages/reactive-engine/src/`). | The engine is small, or the upstream repo cannot be submoduled (access, licensing, size). |
| **C — Package dependency** | Add a `package.json` dependency (`"reactive-engine": "file:../reactive-engine"` or a published npm package name + version) plus a resolution that makes the source inspectable (not a bundled/minified blob). | The engine is a published npm/Node.js package with source-distributable artifacts. |
| **D — Monorepo workspace reference** | Add the engine package to the monorepo workspace config and reference it via workspace protocol. | The engine already lives in a sibling directory of the same monorepo. |

- **Priority:** Must-have — exactly one path must be chosen and documented.
- **Rationale:** Without a binding path decision, execution is ambiguous and the task cannot be handed off to the developer.

#### RQ-4 — Verifiability
After binding, a human or agent must be able to confirm presence with a single glob invocation:

```bash
# Expected: ≥ 1 result per glob, with matching source content
ls **/*autorun* **/*signal* **/*reactiv* **/*scheduler* **/*computed* **/*batch*
```

- **Priority:** Must-have.
- **Rationale:** FR-4 and the acceptance criteria depend on verifiable file-tree evidence. The agent executing #687 will run these globs as a precondition check.

#### RQ-5 — Isolation
Only the engine source code itself must be bound. The following must NOT be pulled in:
- Unrelated application code from the engine's host repository.
- Build artifacts, `node_modules/`, or compiled output (unless the engine is a pre-built artifact by design — see Path C).
- Duplicate copies of the `agent-runtime/` tree already present in this repo.

- **Priority:** Should-have.
- **Rationale:** Minimizes PR noise and avoids confusion about which code is under test. The #687 PR should contain only the engine + the test file, not an entire auxiliary application.

#### RQ-6 — Language / Runtime Compatibility
The engine must be consumable by the Node.js/TypeScript test environment used by #687. If the engine is in another language (e.g., Swift in `agent-runtime/Swabble/`), it is **not** acceptable — a TypeScript/JavaScript implementation is required.

- **Priority:** Must-have.
- **Rationale:** The existing `agent-runtime/` tree is TypeScript; #687 tests will be written in TypeScript/Node.js. A Swift or Python engine would require bridging infrastructure that is out of scope.

### Assumptions

1. **The engine exists somewhere.** It is assumed that the reactive engine described in the #687 PRD exists in a separate repository or package, and was not fabricated for the PRD alone. If it does not exist, #687 must be re-scoped to include engine creation as a prerequisite.

2. **The engine is open-source or internally accessible.** The repo is assumed to be accessible to the agents working on this project. Private repos may require credential setup.

3. **The engine is TypeScript/JavaScript.** Based on the `agent-runtime/` codebase conventions (TypeScript, Node.js, `.ts` extensions, Vitest test files).

4. **Binding Path A (submodule) or B (in-repo commit) is preferred.** Path C (package dependency) is acceptable but requires the package to ship source, not just `.d.ts` + minified `.js`. Path D is unlikely given there is no monorepo workspace config present.

### Dependencies

- **Upstream:** None — this task only requires locating and binding an existing codebase.
- **Downstream:** Task #687 depends on this task's completion. The #687 agent should check for the engine's presence (via glob) as its first step and abort with a clear message if it is absent.
- **Infrastructure:** If Path A (submodule) is chosen, Git must have network access to the engine's remote. If Path C, npm must be able to resolve and install the package.

### Non-Functional Requirements

- **NFR-1 — Inspectability:** Engine source must be human-readable and un-minified on the branch. Minified/bundled blobs are not acceptable (they defeat the purpose of binding for review and testing).
- **NFR-2 — Reproducibility:** The binding must be reproducible: another checkout of the same branch must produce the identical engine source tree without manual steps beyond `git clone --recurse-submodules` (if submodule) or `npm install` (if package).
- **NFR-3 — Branch size:** The binding should not add more than 500 files to the branch. If the engine repo is larger, bring only the engine's source subdirectory, not its entire history and auxiliary packages.

### Traceability to #687

| #687 Test Case | Engine Primitive Required | This PRD's Requirement |
|----------------|--------------------------|------------------------|
| FR-1: Basic signal create + get + set | `signal` | RQ-2 |
| FR-2: autorun fires on assignment | `autorun`, `signal` | RQ-2 |
| FR-3: batch defers autorun until flush | `batch`/`transaction`, `autorun`, `signal` | RQ-2 |
| FR-4: computed lazy evaluation + caching | `computed`/`derived`, `signal` | RQ-2 |
| FR-5: Diamond dependency de-duplication | `autorun`, `signal`, scheduler | RQ-2 |
| FR-6: autorun fires exactly once per tick | `autorun`, `signal`, scheduler | RQ-2 |
| Precondition: engine present | All | RQ-1, RQ-4 |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._