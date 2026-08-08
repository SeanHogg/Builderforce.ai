> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1537
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Fix PR Merge Livelock

## Problem & Goal

The autonomy merge loop is in a livelock: 40,580 `updatePullRequestBranch` syncs produced only 17 successful merges (a ratio of 2,387 syncs per merge). The manager re‑syncs and defers indefinitely instead of merging, clogging the pipeline with 368 open PRs (359 older than 3 days, oldest 55 days). Root cause: `updatePullRequestBranch` reports success even when the branch is unmergeable, causing the caller to defer on every pass and never proceed to merging.

**Goal:** Fix the mergeability state reporting so that the merge loop correctly distinguishes mergeable vs. unmergeable PRs after a branch update, breaks the livelock, and allows the backlog of merges to proceed.

## Target users / ICP roles

- **Autonomy System Operator / SRE** – monitors pipeline health, needs efficient resource usage and timely merges.
- **Development Teams** – waiting for PR merges that are delayed by the clogged pipeline, impacting delivery cycles.

## Scope

- The merge loop’s handling of `updatePullRequestBranch` responses.
- Accurate determination of mergeability* after a branch sync.
- Prevention of endless re‑sync / deferral for unmergeable PRs.
- Regression testing of the merge flow for both mergeable and unmergeable PRs.

**Scope note:** The fix will not alter the full merge / autonomy workflow beyond the detection and handling of unmergeable states.

## Functional requirements

### FR1 – Accurate mergeability state reporting

After calling `updatePullRequestBranch`, the system MUST NOT treat a successful sync as a signal that the branch is ready to merge. It must separately verify mergeability (e.g., via Git’s merge‑base checks or platform API mergeable flag).

### FR2 – Proper differentiation in the caller

The merge loop caller MUST:

- Retrieve the PR’s actual mergeable status after the sync.
- If mergeable → proceed to merge immediately (no additional sync).
- If not mergeable → **do not** defer and re‑sync in a tight loop; instead, apply a sensible backoff / exit strategy (e.g., exponential backoff, skip until next scheduled poll, or flag for manual attention after a threshold).

### FR3 – Cease infinite deferral loops

Implement a guard that prevents the same PR from being sync‑retried more than N times within a time window without progressing. After reaching the limit, the PR is either quarantined for manual review or placed into a held state (still counted as open but excluded from active sync rotation).

### FR4 – Logging & observability

Add structured log events that distinguish:

- Sync success + mergeable (path to merge)
- Sync success + unmergeable (correctly deferred)
- Repeated syncs without merge (potential alert)

## Acceptance criteria

1. **Merge throughput restored:** The number of syncs per successful merge drops to ≤ 10 under normal production load (from the current 2,387:1). Empirically, no more than 2 syncs per merge for straightforward PRs.
2. **Unmergeable PRs are handled gracefully:**
   - An unmergeable PR is synced at most **X** times (e.g., 3) before being quarantined or skipped for at least a configurable cool‑down period (e.g., 30 min).
   - The 368 open PRs are evaluated and either merged (if mergeable) or correctly deferred/quarantined without re‑syncing indefinitely.
3. **No regression in merge correctness:** All mergeable PRs that enter the loop are merged without manual intervention, and no false “ready to merge” states lead to premature merges.
4. **Observability:** Logs clearly show the decision path for each PR: sync outcome, mergeability check result, and action taken (merge / defer / quarantine).
5. **Pipeline capacity:** After the fix, dispatch/processing capacity is no longer consumed by sync‑only loops, freeing resources to process the `never_started` cohort and other pending work.

## Out of scope

- Overhauling the entire autonomy pipeline architecture.
- Changing the underlying `updatePullRequestBranch` API itself (unless a bug is found in the API’s mergeability response).
- Introducing semi‑automated merge conflict resolution.
- Adjusting the merge strategy beyond the current (e.g., rebase‑vs‑merge policy).
- Performance optimisation unrelated to the livelock.

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