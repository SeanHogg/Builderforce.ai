> **PRD** — drafted by Ada (Sr. Product Mgr) · task #688
> _Each agent that updates this PRD signs its change below._

# PRD: Audit `tasks.update` Handler for `parentTaskId` Mutation

## Problem & Goal

The `tasks.update` tRPC handler is silently dropping the `parentTaskId` field during update operations. When a task update payload includes `parentTaskId`, the value is not persisted — either it is stripped before reaching the database layer, overwritten by a merge operation, or never included in the write path. This causes task hierarchy relationships to be broken without any error surfacing to the caller.

**Goal:** Identify the exact code path(s) responsible for dropping `parentTaskId`, document root cause(s), and produce a fix that preserves `parentTaskId` through the full update lifecycle including the `assignedAgentRef` mutation path and any auto-run side-effect triggers.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Backend / API engineers** | Understand which handler layer drops the field and own the fix |
| **Agent framework engineers** | Understand how auto-run side effects interact with task state shape |
| **QA / Test engineers** | Define regression coverage for task hierarchy mutations |
| **Product / Tech leads** | Understand blast radius and whether existing data is corrupted |

---

## Scope

This audit covers:

- The `tasks.update` tRPC procedure definition (input schema, middleware, resolver)
- The `assignedAgentRef` mutation sub-path within that handler
- Auto-run side-effect triggers invoked after a task update (e.g., agent dispatch, status transitions)
- The database write call(s) (ORM query, raw query, or repository method) that persist task updates
- Any field-allow-listing, spread/merge operations, or partial-update patterns applied before the write

---

## Functional Requirements

### FR-1 — Schema Audit
- Inspect the Zod (or equivalent) input schema for `tasks.update`.
- Confirm whether `parentTaskId` is declared as an accepted field.
- Confirm whether it is marked optional, required, or absent (and therefore stripped by `.strict()` or equivalent).

### FR-2 — Resolver Data-Flow Trace
- Trace the resolved input object from entry point through every transformation before it reaches the DB write call.
- Identify every `pick`, `omit`, `select`, field-allowlist, or object spread that could exclude `parentTaskId`.

### FR-3 — `assignedAgentRef` Code Path Audit
- Identify the branch that handles `assignedAgentRef` mutations specifically.
- Determine whether this branch reconstructs or replaces the update payload rather than merging into it.
- Check whether `parentTaskId` survives if `assignedAgentRef` is present in the same update payload.

### FR-4 — Auto-Run Side-Effect Audit
- Identify all side-effect functions called post-write (e.g., `triggerAutoRun`, `dispatchAgent`, status-change hooks).
- Determine whether any side effect issues a second `update` call that overwrites fields without including `parentTaskId`.
- Confirm that side-effect-triggered writes use a targeted partial update (only the fields they own) rather than a full document replace.

### FR-5 — Database Write Audit
- Inspect the final DB call (e.g., `prisma.task.update`, MongoDB `updateOne`, etc.).
- Determine whether it uses `data: input` (full replace of provided fields) vs. a reconstructed object that could omit `parentTaskId`.
- Verify that no `upsert` or `replaceOne` semantics accidentally replace the stored document.

### FR-6 — Root Cause Documentation
- Produce a written root-cause analysis identifying:
  - The file and line number(s) where `parentTaskId` is dropped.
  - The mechanism (schema strip, allowlist, overwrite, etc.).
  - Whether multiple drop sites exist.

### FR-7 — Fix Implementation
- Patch the identified drop site(s) so `parentTaskId` is preserved.
- Ensure the fix does not break existing behavior for updates that do not include `parentTaskId`.
- Ensure fix applies consistently whether or not `assignedAgentRef` or auto-run side effects are present.

### FR-8 — Regression Tests
- Add or update unit/integration tests covering:
  - Update with `parentTaskId` only.
  - Update with `parentTaskId` + `assignedAgentRef` together.
  - Update that triggers auto-run, asserting `parentTaskId` is unchanged post-side-effect.
  - Update without `parentTaskId`, asserting existing `parentTaskId` on the record is not cleared.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | `parentTaskId` provided in the update payload is persisted to the database record after `tasks.update` completes. | Integration test: read-back the record post-update and assert field equality. |
| AC-2 | `parentTaskId` is preserved when the same payload also contains `assignedAgentRef`. | Integration test covering combined payload. |
| AC-3 | Auto-run side effects do not clear or overwrite `parentTaskId` on the task record. | Integration test asserting field value after side effects execute. |
| AC-4 | A task updated without `parentTaskId` in the payload retains its existing stored `parentTaskId` (no accidental null-out). | Integration test: pre-set `parentTaskId`, update an unrelated field, assert `parentTaskId` unchanged. |
| AC-5 | The Zod input schema explicitly includes `parentTaskId` as an optional field and does not strip it. | Unit test or schema-level assertion. |
| AC-6 | No second write path (side effect) issues a full-replace write that omits `parentTaskId`. | Code review finding documented; covered by AC-3 test. |
| AC-7 | All existing `tasks.update` tests continue to pass. | CI green on full test suite. |
| AC-8 | Root-cause analysis document (or inline code comments) identifies the drop site, mechanism, and fix rationale. | PR description / doc review. |

---

## Out of Scope

- Changes to any other tRPC procedure beyond `tasks.update`.
- Migration or backfill of existing task records that may have lost `parentTaskId` due to this bug (flagged as a follow-up).
- UI-layer changes to how `parentTaskId` is sent in requests.
- Redesigning the task hierarchy data model or schema.
- Performance optimization of the `tasks.update` handler.
- Changes to authorization/permission logic governing who may set `parentTaskId`.

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