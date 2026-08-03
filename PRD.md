> **PRD** — drafted by Ada (Sr. Product Mgr) · task #647
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Task Activity Summary

## Problem & Goal
**Problem:** Users need to quickly understand the execution history of a task (last run time, who ran it, total runs, and whether the most recent code‑generating run produced output) without fetching full execution logs. Currently, this information is scattered across execution histories or missing entirely, forcing team members to dig through logs for simple status checks.

**Goal:** Provide a lightweight, at‑a‑glance activity summary for each task. This summary will help agents and humans decide whether to re‑run a task, inspect recent results, or track execution frequency.

## Target Users / ICP Roles
- **Developers:** Want to know if a task’s last run by a coder agent produced code changes.
- **Team Leads / Project Managers:** Need to monitor how often tasks are executed and by whom, for reporting and resource allocation.
- **Automation Engineers:** Use summary data in pipelines to conditionally trigger downstream actions (e.g., only review tasks where last coder run produced code).
- **QA / Reviewers:** Rely on summary to prioritise reviewing tasks that have new code.

## Scope
Introduce a new endpoint or enhance the existing `tasks.get` response to include a lightweight activity summary:

- `tasks.activity` — dedicated endpoint returning only activity metadata for a given task ID.
- **Alternative:** Extend `tasks.get` with an optional `includeActivity` flag. The final implementation choice will be decided during design, but the data contract is consistent.

The summary will be computed from existing task execution records and cached/aggregated for fast reads. It does **not** include full execution history or logs.

## Functional Requirements
1. **Response Fields**
   - `lastExecutionAt` (timestamp, nullable): Date/time of the most recent execution of any kind.
   - `lastExecutionAgentRef+role` (object): Contains:
     - `agentRef` (string): Identifier of the agent (human or automated) that performed the last execution.
     - `role` (string): Role of that agent at the time of execution (e.g., `coder`, `reviewer`, `tester`).
   - `executionsCount` (integer): Total number of times the task has been executed (all agents).
   - `lastCoderRunProducedCode` (boolean, nullable): Whether the most recent execution by an agent with role `coder` resulted in code being produced (e.g., a commit, file change, or diff). Null if no coder execution has ever occurred.

2. **Data Source & Computation**
   - Derived from the system’s task execution logs.
   - `lastExecutionAt`, `lastExecutionAgentRef`, `role`, and `executionsCount` are taken from the most recent execution record regardless of role.
   - `lastCoderRunProducedCode` is determined by scanning execution records for the most recent entry where `role = "coder"`, then inspecting a boolean flag `producedCode` stored with that execution. If no coder run exists, the field is `null`.
   - Aggregates must be updated synchronously every time a task execution completes, or lazily refreshed with acceptable staleness (e.g., ≤5 seconds) to ensure data consistency.

3. **Error Handling & Edge Cases**
   - If a task has never been executed, `lastExecutionAt` is `null`, `lastExecutionAgentRef+role` is `null`, `executionsCount` is `0`, and `lastCoderRunProducedCode` is `null`.
   - If a task has been executed but never by a coder, `lastCoderRunProducedCode` remains `null`, while other fields reflect the last execution of any role.
   - The system must gracefully handle missing execution metadata (e.g., if an older execution record lacks a `producedCode` flag, treat it as `false` for that run).

4. **Performance & Scalability**
   - The summary should be returned in O(1) time by reading pre‑computed aggregates (e.g., stored in the task document or a dedicated cache).
   - No expensive scans over execution history during reads.

## Acceptance Criteria
1. **Given** a task with no execution history, **when** I request its activity summary, **then** I receive:
   - `lastExecutionAt: null`
   - `lastExecutionAgentRef+role: null`
   - `executionsCount: 0`
   - `lastCoderRunProducedCode: null`

2. **Given** a task executed 3 times, the last by a `reviewer` agent `rev-42` at `T3`, and a previous coder run at `T2` that produced code, **when** I request the summary, **then** I receive:
   - `lastExecutionAt: T3`
   - `lastExecutionAgentRef+role: { agentRef: "rev-42", role: "reviewer" }`
   - `executionsCount: 3`
   - `lastCoderRunProducedCode: true` (because the most recent coder run, at T2, produced code)

3. **Given** a task where the last coder run did not produce code, **when** I request the summary, **then** `lastCoderRunProducedCode` is `false`.

4. **Given** a task executed only by non‑coder agents, **when** I request the summary, **then** `lastCoderRunProducedCode` is `null`.

5. After a new execution finishes, the summary reflects the new values without manual cache invalidation (automatic update within 5 seconds).

6. The endpoint responds in under 100ms for 99% of requests under normal load.

## Out of Scope
- Full execution history or logs (existing endpoints cover this).
- Ability to filter activity summary by a specific agent or role (e.g., “last reviewer run”).
- Historical or time‑series aggregation (e.g., “number of coder runs in the last week”).
- Push notifications or real‑time streaming of activity changes.
- Detailed metadata about what code was produced (only a boolean flag is provided).
- Backfilling historical `producedCode` flags for runs before this feature existed (they will be treated as `false` or omitted, but the field will be `null` if no coder run record exists).

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