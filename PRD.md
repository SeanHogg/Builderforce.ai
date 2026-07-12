> **PRD** — drafted by John Coder ((V2) (Durable)) · task #643
> _Each agent that updates this PRD signs its change below._

# PRD: Ticket Detail Progress Breakdown Object

## Problem & Goal

Ticket detail responses currently provide no structured, machine-readable summary of how far along a ticket is. Consumers (UI widgets, automation scripts, downstream agents) are forced to infer progress by independently querying subtasks, pull requests, and status fields — leading to duplicated logic, inconsistent interpretations, and brittle integrations.

**Goal:** Expose a single canonical `progress` object on every ticket detail response (both the full `tasks.get` payload and the compact list item shape) that communicates progress basis and key signal fields in one place.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Frontend engineers | Render progress bars, status chips, and PR badges without extra round-trips |
| Automation / agent scripts | Gate actions (e.g., deploy, close) on objective progress signals |
| Project managers / dashboard builders | Aggregate ticket health across a project without custom join logic |
| QA engineers | Quickly determine whether tests are passing before approving a review |

---

## Scope

This PRD covers the **shape, population logic, and contract** of the `progress` object returned on:

1. `tasks.get` (single ticket, full detail)
2. Compact list items (e.g., results from `tasks.list`, board queries, search results)

It does **not** cover storage schema changes, new write endpoints, or UI rendering.

---

## Functional Requirements

### FR-1 — Progress Object Shape

Every ticket response MUST include a top-level `progress` field conforming to the following TypeScript-style interface:

```ts
interface TicketProgress {
  /**
   * The primary signal used to calculate overall progress percentage.
   * Determines which fields are authoritative for progress computation.
   */
  basis: "subtasks" | "pr" | "status" | "manual";

  /** Subtask counts — always populated when subtasks exist, otherwise null. */
  subtasksDone:  number | null;
  subtasksTotal: number | null;

  /** True once at least one PR linked to this ticket has been merged. */
  codeDelivered: boolean;

  /**
   * Reflects CI/test state of the most-recent linked PR.
   * null  → no linked PR or CI not configured.
   * false → CI running or at least one check failing.
   * true  → all required checks passing.
   */
  testsPassing: boolean | null;

  /**
   * Aggregated state of all linked pull requests.
   * null if no PRs are linked.
   */
  prState: "none" | "open" | "review" | "approved" | "merged" | "closed" | null;
}
```

### FR-2 — Basis Selection Logic

The `basis` field MUST be determined by the following priority order (first match wins):

1. **`"manual"`** — a human or automation has explicitly set a numeric progress value on the ticket.
2. **`"subtasks"`** — the ticket has one or more subtasks (regardless of their completion state).
3. **`"pr"`** — no subtasks exist but one or more pull requests are linked.
4. **`"status"`** — neither subtasks nor PRs are present; progress is inferred from workflow status position.

### FR-3 — Subtask Fields

- `subtasksDone` and `subtasksTotal` MUST be populated (non-null integers) whenever `subtasksTotal > 0`.
- When no subtasks exist both fields MUST be `null`.
- Subtask counts MUST reflect **direct children only** (not recursively nested sub-subtasks) unless the implementation already traverses all descendants consistently — in which case the behavior MUST be documented and consistent across both endpoints.

### FR-4 — `codeDelivered` Flag

- `codeDelivered` is `true` if and only if **at least one** PR linked to the ticket has state `merged`.
- It remains `false` if all linked PRs are open, in review, approved, or closed without merging.
- It MUST be `false` (not `null`) when no PRs are linked.

### FR-5 — `testsPassing` Field

- Evaluated against the **most recently updated** linked PR that has CI results.
- `true` — all required status checks on that PR are in a passing/success state.
- `false` — one or more required checks are pending, running, or failing.
- `null` — no linked PRs exist, or no CI integration is configured for the repository.

### FR-6 — `prState` Aggregation

When multiple PRs are linked, `prState` MUST reflect the **highest-priority state** using the following hierarchy (highest → lowest):

```
merged > approved > review > open > closed > none
```

- `null` is returned only when no PRs are linked at all.
- `"none"` is a valid explicit value when PRs are linked but all have been explicitly dismissed/unlinked at the provider level (edge case).

### FR-7 — Compact List Parity

The `progress` object on compact list items MUST be **identical in shape** to the full `tasks.get` response. No fields may be omitted or substituted with placeholder values in list contexts. Implementations MAY batch-compute progress fields to optimize list query performance.

### FR-8 — Consistency

- The `progress` object MUST be recomputed (or invalidated and re-fetched from source) whenever subtasks, PR links, CI status, or the manual progress value change.
- Stale cache TTL for `testsPassing` and `prState` MUST NOT exceed **60 seconds** in production environments.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `tasks.get` response includes a `progress` object with all five fields present and correctly typed. |
| AC-2 | Compact list items include an identical `progress` object with no missing fields. |
| AC-3 | `basis` correctly reflects the priority logic in FR-2 across all four basis types, verified by unit tests covering each branch. |
| AC-4 | A ticket with 3 subtasks (2 done) returns `subtasksDone: 2`, `subtasksTotal: 3`, `basis: "subtasks"`. |
| AC-5 | A ticket with no subtasks and one merged PR returns `codeDelivered: true`, `prState: "merged"`, `basis: "pr"`. |
| AC-6 | A ticket with no subtasks and no PRs returns `codeDelivered: false`, `testsPassing: null`, `prState: null`, `basis: "status"`. |
| AC-7 | A ticket with a manually set progress value returns `basis: "manual"` regardless of subtask or PR presence. |
| AC-8 | When multiple PRs are linked, `prState` returns the highest-priority state per FR-6. |
| AC-9 | `testsPassing` returns `null` when no CI integration is configured, `false` when any required check is pending/failing, and `true` when all pass. |
| AC-10 | Integration tests confirm compact list and single-get return identical `progress` values for the same ticket. |
| AC-11 | Response time for `tasks.list` with progress fields does not regress beyond **200 ms p95** on a 500-ticket result set (benchmarked in CI). |

---

## Out of Scope

- **Write API for progress** — no new endpoint or field for manually setting `basis` or overriding computed values (manual progress is set through the existing ticket update mechanism).
- **Recursive subtask aggregation changes** — depth-of-traversal policy is out of scope; current behavior is preserved and documented only.
- **UI rendering** — how clients display the `progress` object is not specified here.
- **Webhook / event emission** — pushing progress change events to subscribers is a separate workstream.
- **Third-party CI provider onboarding** — expanding CI integration coverage beyond currently supported providers is out of scope.
- **Historical progress tracking / time series** — only current state is returned; no audit log or trend data.
- **Access control changes** — progress fields inherit the same visibility rules as the parent ticket.